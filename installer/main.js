'use strict';

/**
 * Processus principal Electron — Cockpit Agent Installer.
 *
 * Responsabilités :
 *  - Créer la fenêtre BrowserWindow
 *  - Gérer tous les handlers IPC (sql:test, sql:detect, sql:deploy, api:validate, service:install)
 *  - Tout accès SQL ou système passe ici — jamais dans le renderer (règle de sécurité Electron)
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path    = require('path');

// Empêcher le dialog natif Electron "A JavaScript error occurred in the main process"
// Les erreurs sont loggées en console et retournées comme erreurs IPC classiques.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});

// Charger les variables d'environnement depuis .env.dev en mode développement
const IS_DEV_EARLY = !app.isPackaged;
if (IS_DEV_EARLY) {
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '..', '.env.dev');
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const [key, ...val] = line.trim().split('=');
        if (key && !key.startsWith('#')) process.env[key.trim()] = val.join('=').trim();
      });
    }
  } catch (_) {}
}

const sql     = require('mssql');
// msnodesqlv8 : driver natif ODBC pour Windows Integrated Security
// Requis uniquement quand useWindowsAuth = true (tedious ne supporte pas SSPI)
const axios   = require('axios');
const Service = require('node-windows').Service;
const { machineIdSync } = require('node-machine-id');

const { deployViews }       = require('./lib/deployer');
const { detectSageCapabilities } = require('./lib/detector');
const { saveCredential }    = require('./lib/credential-store');
const { saveToken }         = require('./lib/token');
const { SERVICE_NAME, SERVICE_DESCRIPTION, HEALTH_PORT } = require('../shared/constants');

const IS_DEV = IS_DEV_EARLY;

// Pool SQL courant (maintenu pendant toute la session d'installation)
let _pool = null;

// Tables Sage détectées lors de api:validate — réutilisées dans service:install
let _detectedTables = [];

// Capacités Sage détectées lors de sql:detect — réutilisées dans service:install
let _detectedCaps = null;

// ─── Fenêtre principale ───────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width:           900,
    height:          700,
    resizable:       false,
    frame:           true,
    title:           'Cockpit Agent — Installation',
    icon:            path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
    },
  });

  if (IS_DEV) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  win.setMenuBarVisibility(false);
  return win;
}

let _win = null;

app.whenReady().then(() => {
  _win = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) _win = createWindow();
  });
});

app.on('window-all-closed', async () => {
  if (_pool) await _pool.close().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC : Test connexion SQL ─────────────────────────────────────────────────

ipcMain.handle('sql:test', async (_, { server, port, instance, database, useWindowsAuth, user, password }) => {
  try {
    if (_pool) await _pool.close().catch(() => {});

    // Normalisation de l'adresse pour Docker / WSL sur Windows
    const targetServer = (server === 'localhost') ? '127.0.0.1' : server;

    if (useWindowsAuth) {
      let mssqlOdbc;
      try {
        mssqlOdbc = require('mssql/msnodesqlv8');
      } catch (e) {
        return { 
          success: false, 
          error: "Le module msnodesqlv8 est requis pour l'authentification Windows. Erreur: " + e.message 
        };
      }

      const serverStr = instance
        ? `${targetServer}\\${instance}`
        : (port ? `${targetServer},${port}` : targetServer);

      const connStr = `Driver={ODBC Driver 17 for SQL Server};Server=${serverStr};Database=${database};Trusted_Connection=yes;TrustServerCertificate=yes;`;
      _pool = await mssqlOdbc.connect({ connectionString: connStr, pool: { max: 1, min: 0 } });

    } else {
      const config = {
        server: targetServer,
        database,
        user,
        password,
        port: port ? parseInt(port, 10) : 1433,
        options: {
          trustServerCertificate: true,
          enableArithAbort: true,
          encrypt: true,
          instanceName: instance || undefined,
        },
        connectionTimeout: 15000,
        pool: { max: 1, min: 0 },
      };
      // On utilise le package 'mssql' standard (tedious) chargé au début du fichier
      _pool = await sql.connect(config);
    }

    const res = await _pool.request().query("SELECT @@VERSION AS v");
    const version = res.recordset[0].v.split('\n')[0];
    return { success: true, version };

  } catch (err) {
    console.error('SQL Connection Error:', err);
    _pool = null;
    
    // Sérialisation propre de l'erreur (incluant les propriétés non-énumérables comme message et stack)
    const errorDetails = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
    return { success: false, error: errorDetails };
  }
});

// ─── IPC : Détection Sage 100 ─────────────────────────────────────────────────

ipcMain.handle('sql:detect', async () => {
  if (!_pool) return { success: false, error: 'Connexion SQL non établie' };
  try {
    const caps = await detectSageCapabilities(_pool);
    _detectedCaps = caps; // mémoriser pour service:install
    return { success: true, caps };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC : Déploiement des vues SQL ──────────────────────────────────────────

ipcMain.handle('sql:deploy', async (event) => {
  if (!_pool) return { success: false, error: 'Connexion SQL non établie' };
  try {
    const caps = await deployViews(_pool, (step, total, current, status) => {
      event.sender.send('sql:progress', { step, total, current, status });
    });
    return { success: true, caps };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC : Validation token API Cockpit ──────────────────────────────────────

ipcMain.handle('api:validate', async (_, { email, token }) => {
  try {
    const platformUrl = process.env.COCKPIT_URL || 'https://cockpit.nafakatech.com';
    const machineId   = machineIdSync();

    // Collecter les tables Sage détectées si disponible
    let sageTables = [];
    if (_pool) {
      try {
        const r = await _pool.request().query(`
          SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_NAME LIKE 'F_%' ORDER BY TABLE_NAME
        `);
        sageTables = r.recordset.map(x => x.TABLE_NAME);
      } catch (_) {}
    }

    const response = await axios.post(
      `${platformUrl}/api/v1/agent/validate`,
      { email, token, machineId, sageTables },
      { timeout: 15000 }
    );

    if (response.data?.valid) {
      // Stocker le token chiffré sur le disque et mémoriser les tables détectées
      saveToken(token);
      _detectedTables = sageTables;
      return { success: true, ...response.data };
    }
    return { success: false, error: response.data?.error || 'Token invalide' };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    return { success: false, error: msg };
  }
});

// ─── IPC : Installation du service Windows ────────────────────────────────────

ipcMain.handle('service:install', async (event, { sqlConfig, agentId }) => {
  const progress = (step, total, label) =>
    event.sender.send('service:progress', { step, total, label });

  try {
    // 1. Sauvegarder le mot de passe SQL dans Windows Credential Manager
    progress(1, 5, 'Sauvegarde des identifiants SQL…');
    if (sqlConfig.password) {
      await saveCredential('sql_password', sqlConfig.password);
    }

    // 2. Sauvegarder la configuration dans config.json
    progress(2, 5, 'Écriture de la configuration…');
    const config = require('./lib/config');
    config.save({
      sql_server:           sqlConfig.server,
      sql_port:             sqlConfig.port ? parseInt(sqlConfig.port, 10) : null,
      sql_instance:         sqlConfig.instance || null,
      sql_database:         sqlConfig.database,
      sql_use_windows_auth: sqlConfig.useWindowsAuth,
      sql_user:             sqlConfig.user || null,
      agent_id:             agentId,
      platform_url:         process.env.COCKPIT_URL || 'https://cockpit.nafakatech.com',
      allowed_tables:       _detectedTables,
      max_rows:             1000,
      query_timeout:        5,
      // Config Sage envoyée automatiquement au backend lors de la première connexion WebSocket
      sage_type:            sqlConfig.sageType || '100',           // "100" | "X3" — sélectionné dans l'UI
      sage_version:         _detectedCaps?.sageVersion || null,    // "v21plus" | "v15v17" | "fallback"
    });

    // 3. Installer / démarrer le service
    progress(3, 5, 'Installation du service Windows…');
    const servicePath = IS_DEV
      ? path.join(__dirname, '..', 'service', 'src', 'index.js')
      : path.join(process.resourcesPath, 'service', 'dist', 'cockpit-agent-service.exe');

    if (IS_DEV) {
      // En dev : spawn node détaché — évite les problèmes de node-windows avec Electron
      const { spawn } = require('child_process');
      const nodeExe = process.env.npm_node_execpath || process.env.NODE || 'node';
      const child = spawn(nodeExe, [servicePath], {
        detached: true,
        stdio:    'ignore',
        env:      { ...process.env, COCKPIT_LOG_DIR: path.join(__dirname, '..', 'service', 'logs') },
      });
      child.unref();
      event.sender.send('service:progress', { step: 3, total: 5, label: 'Service démarré (mode dev)…' });
    } else {
      // En prod : winsw (Windows Service Wrapper) — seule solution compatible avec un exe
      // pkg autonome. sc.exe / node-windows échouent (error 1053) car pkg n'implémente
      // pas le protocole SCM (SetServiceStatus). winsw agit comme proxy SCM → exe pkg.
      const { execFileSync } = require('child_process');
      const fs = require('fs');

      // Dossier daemon : à côté de Cockpit Agent.exe (hors asar, toujours accessible en écriture)
      const daemonDir = path.join(path.dirname(process.execPath), 'daemon');
      fs.mkdirSync(daemonDir, { recursive: true });

      const winswSrc = path.join(process.resourcesPath, 'winsw.exe');
      const winswExe = path.join(daemonDir, `${SERVICE_NAME}.exe`);

      // XML : toujours écrasable (pas de verrou SCM dessus)
      // Quand Windows Auth est utilisée, le service DOIT tourner sous le compte Windows
      // courant (pas LocalSystem) pour que SSPI puisse négocier l'accès SQL Server.
      const xmlLines = [
        '<service>',
        `  <id>${SERVICE_NAME}</id>`,
        `  <name>${SERVICE_NAME}</name>`,
        `  <description>${SERVICE_DESCRIPTION}</description>`,
        `  <executable>${servicePath}</executable>`,
      ];
      if (sqlConfig.useWindowsAuth && sqlConfig.windowsPassword) {
        const saDomain = process.env.USERDOMAIN || '.';
        const saUser   = process.env.USERNAME   || '';
        xmlLines.push(
          '  <serviceaccount>',
          `    <domain>${saDomain}</domain>`,
          `    <user>${saUser}</user>`,
          `    <password>${sqlConfig.windowsPassword}</password>`,
          '    <allowservicelogon>true</allowservicelogon>',
          '  </serviceaccount>',
        );
      }
      xmlLines.push('  <logmode>rotate</logmode>', '  <stoptimeout>30sec</stoptimeout>', '</service>');
      const xmlContent = xmlLines.join('\r\n');
      fs.writeFileSync(path.join(daemonDir, `${SERVICE_NAME}.xml`), xmlContent, 'utf8');

      // L'app Electron est lancée de-élevée par NSIS → winsw (WMI) nécessite admin.
      // IMPORTANT : CockpitAgent.exe peut être verrouillé par le SCM si le service
      // existe déjà. La copie de winsw.exe se fait DANS le script élevé, après
      // stop/uninstall (qui libère le verrou), évitant EBUSY.
      const q = (s) => s.replace(/'/g, "''");   // escape PS single-quote
      const winswCfgSrc = path.join(process.resourcesPath, 'winsw.exe.config');
      const winswCfgExe = path.join(daemonDir, `${SERVICE_NAME}.exe.config`);
      const psScript = path.join(daemonDir, 'install-service.ps1');
      fs.writeFileSync(psScript, [
        `$ErrorActionPreference = 'Stop'`,
        `$winsw    = '${q(winswExe)}'`,
        `$winswSrc = '${q(winswSrc)}'`,
        `$winswCfg = '${q(winswCfgSrc)}'`,
        `$winswCfgDest = '${q(winswCfgExe)}'`,
        `# 1. Copier winsw.exe + son .config AVANT toute opération SCM`,
        `#    Le .config est indispensable pour que le CLR .NET charge la bonne runtime.`,
        `Copy-Item -Force -Path $winswSrc -Destination $winsw`,
        `if (Test-Path $winswCfg) { Copy-Item -Force -Path $winswCfg -Destination $winswCfgDest }`,
        `# 2. Stopper + supprimer le service existant (mode Continue pour ne pas bloquer si absent)`,
        `$ErrorActionPreference = 'Continue'`,
        `sc.exe stop   '${SERVICE_NAME}' 2>&1 | Out-Null`,
        `Start-Sleep -Seconds 3`,
        `sc.exe delete '${SERVICE_NAME}' 2>&1 | Out-Null`,
        `# 3. Attendre que SCM confirme la suppression (max 30s)`,
        `#    On cherche "1060" dans la sortie (compatible FR/EN : "FAILED 1060" / "échec(s) 1060")`,
        `$waited = 0`,
        `while ($waited -lt 30) {`,
        `  $out = sc.exe query '${SERVICE_NAME}' 2>&1`,
        `  if ($out -match '1060') { break }`,
        `  Start-Sleep -Seconds 1`,
        `  $waited++`,
        `}`,
        `# 4. Tuer les processus résiduels`,
        `try { Stop-Process -Name 'cockpit-agent-service' -Force 2>&1 | Out-Null } catch {}`,
        `try { Stop-Process -Name '${SERVICE_NAME}' -Force 2>&1 | Out-Null } catch {}`,
        `Start-Sleep -Seconds 1`,
        `# 5. Installer + démarrer via winsw`,
        `$ErrorActionPreference = 'Stop'`,
        `& $winsw install`,
        `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
        `& $winsw start`,
        `exit $LASTEXITCODE`,
      ].join('\r\n'), 'utf8');

      // IMPORTANT: le chemin du script contient un espace ("Cockpit Agent").
      // Start-Process -ArgumentList avec un tableau ne quote PAS automatiquement les
      // éléments contenant des espaces → le chemin est coupé et PS ne trouve pas le script.
      // Solution : entourer le chemin de guillemets doubles à l'intérieur du tableau.
      const psScriptQ = q(psScript);
      event.sender.send('service:progress', { step: 3, total: 5, label: 'Élévation UAC requise — acceptez l\'invite Windows…' });
      execFileSync('powershell.exe', [
        '-NonInteractive', '-NoProfile', '-Command',
        `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden` +
        ` -ArgumentList @('-NonInteractive','-NoProfile','-ExecutionPolicy','Bypass','-File','"${psScriptQ}"');` +
        ` if ($p.ExitCode -ne 0) { throw "winsw exit $($p.ExitCode)" }`,
      ], { windowsHide: false, timeout: 60000, encoding: 'utf8' });
    }

    // 4. Attendre que le health check réponde (max 90s — pkg + SCM peuvent prendre du temps)
    let healthy = false;
    for (let i = 0; i < 90; i++) {
      progress(4, 5, `Démarrage du service… (${i + 1}/90)`);
      await new Promise(r => setTimeout(r, 1000));
      try {
        await axios.get(`http://127.0.0.1:${HEALTH_PORT}/health`, { timeout: 2000 });
        healthy = true;
        break;
      } catch (_) {}
    }

    progress(5, 5, healthy ? 'Service opérationnel ✓' : 'Service installé (health check timeout)');
    return { success: true, healthy };
  } catch (err) {
    const message = err?.message ?? (err ? String(err) : 'Erreur inconnue lors de l\'installation');
    return { success: false, error: message };
  }
});

// ─── IPC : Ouvrir le portail dans le navigateur ───────────────────────────────

ipcMain.handle('app:openDashboard', async () => {
  const url = process.env.COCKPIT_FRONT_URL || 'https://cockpit.nafakatech.com';
  await shell.openExternal(url);
});

ipcMain.handle('app:openHealthDashboard', async () => {
  await shell.openExternal(`http://127.0.0.1:${require('../shared/constants').HEALTH_PORT}/`);
});

// ─── IPC : Détection installation existante ───────────────────────────────────

ipcMain.handle('app:checkInstalled', () => {
  try {
    const { getToken } = require('./lib/token');
    const fs = require('fs');

    getToken(); // throws si .cockpit_token absent ou illisible

    // En prod (packaged) : config.json est dans resources/service/dist/
    // En dev             : dans cockpit-agent/service/config.json
    const configPath = app.isPackaged
      ? path.join(process.resourcesPath, 'service', 'dist', 'config.json')
      : path.join(__dirname, '..', 'service', 'config.json');

    if (!fs.existsSync(configPath)) return { installed: false };
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    return {
      installed: true,
      config: {
        sql_server:           cfg.sql_server   || null,
        sql_port:             cfg.sql_port     || null,
        sql_instance:         cfg.sql_instance || null,
        sql_database:         cfg.sql_database || null,
        sql_use_windows_auth: cfg.sql_use_windows_auth || false,
        sql_user:             cfg.sql_user     || null,
        agent_id:             cfg.agent_id     || null,
        sage_type:            cfg.sage_type    || null,
        sage_version:         cfg.sage_version || null,
        platform_url:         cfg.platform_url || null,
      },
    };
  } catch (_) {
    return { installed: false };
  }
});

// ─── IPC : Statut live de l'agent (127.0.0.1:8444/status) ────────────────────

ipcMain.handle('app:getAgentStatus', async () => {
  try {
    const res = await axios.get(
      `http://127.0.0.1:${HEALTH_PORT}/status`,
      { timeout: 3000 },
    );
    return { online: true, status: res.data };
  } catch (_) {
    return { online: false, status: null };
  }
});

// ─── IPC : Mise à jour manuelle du token ─────────────────────────────────────

ipcMain.handle('app:updateToken', async (_, { token }) => {
  // Validation format : isag_ suivi de 48 caractères hex
  if (!/^isag_[0-9a-f]{48}$/.test(token)) {
    return { success: false, error: 'Format de token invalide (attendu : isag_ + 48 caractères hex)' };
  }
  try {
    const { saveToken } = require('./lib/token');
    saveToken(token);
  } catch (err) {
    return { success: false, error: `Impossible de sauvegarder le token : ${err.message}` };
  }
  // Redémarrage du service (best-effort, sans UAC — l'utilisateur a les droits s'il a installé)
  try {
    const { execSync } = require('child_process');
    execSync(`sc.exe stop ${SERVICE_NAME}`,  { timeout: 10000, stdio: 'ignore' });
    execSync(`sc.exe start ${SERVICE_NAME}`, { timeout: 10000, stdio: 'ignore' });
    return { success: true };
  } catch (err) {
    // Token sauvegardé mais redémarrage échoué → informer l'utilisateur
    return { success: true, restartWarning: 'Token mis à jour. Redémarrez le service manuellement depuis les Services Windows.' };
  }
});

// ─── IPC : Redémarrage du service ─────────────────────────────────────────────

ipcMain.handle('app:restartService', async () => {
  try {
    const { execSync } = require('child_process');
    execSync(`sc.exe stop ${SERVICE_NAME}`,  { timeout: 10000, stdio: 'ignore' });
    execSync(`sc.exe start ${SERVICE_NAME}`, { timeout: 10000, stdio: 'ignore' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC : Logs temps réel ────────────────────────────────────────────────────

// Chemin du répertoire de logs selon l'environnement
function _getLogDir() {
  if (IS_DEV) return path.join(__dirname, '..', 'service', 'logs');
  return path.join(process.resourcesPath, 'service', 'dist', 'logs');
}

// Fichier log du jour courant
function _getTodayLogFile() {
  const fs = require('fs');
  const dir = _getLogDir();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const p = path.join(dir, `cockpit-agent-${today}.log`);
  return fs.existsSync(p) ? p : null;
}

// Parse une ligne de log : "2026-05-01 14:32:10 [INFO] message..."
const LOG_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (.+)$/;
function _parseLine(line) {
  const m = line.match(LOG_RE);
  if (!m) return line ? { timestamp: '', level: 'info', message: line } : null;
  return { timestamp: m[1], level: m[2].toLowerCase(), message: m[3] };
}

// Lecture des N dernières lignes d'un fichier
function _tail(filePath, n = 200) {
  const fs = require('fs');
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-n).map(_parseLine).filter(Boolean);
  } catch (_) {
    return [];
  }
}

// Watcher actif (1 seul à la fois)
let _logWatcher   = null;
let _logFileSize  = 0;
let _watchedFile  = null;

ipcMain.handle('app:getLogs', () => {
  const file = _getTodayLogFile();
  if (!file) return { lines: [], file: null };
  return { lines: _tail(file, 200), file };
});

ipcMain.handle('app:startLogStream', () => {
  const fs   = require('fs');
  const file = _getTodayLogFile();
  if (!file || !_win) return { ok: false };

  // Initialiser la position à la fin du fichier
  try { _logFileSize = fs.statSync(file).size; } catch (_) { _logFileSize = 0; }
  _watchedFile = file;

  _logWatcher = fs.watchFile(file, { interval: 800, persistent: false }, () => {
    if (!_win || _win.isDestroyed()) return;
    try {
      const stat = fs.statSync(file);
      if (stat.size <= _logFileSize) return; // truncation ou pas de changement
      const fd  = fs.openSync(file, 'r');
      const len = stat.size - _logFileSize;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, _logFileSize);
      fs.closeSync(fd);
      _logFileSize = stat.size;
      const newLines = buf.toString('utf8').split('\n')
        .filter(Boolean).map(_parseLine).filter(Boolean);
      if (newLines.length) _win.webContents.send('logs:lines', newLines);
    } catch (_) {}
  });

  return { ok: true, file };
});

ipcMain.handle('app:stopLogStream', () => {
  const fs = require('fs');
  if (_logWatcher && _watchedFile) {
    fs.unwatchFile(_watchedFile);
    _logWatcher  = null;
    _watchedFile = null;
  }
  return { ok: true };
});

// ─── IPC : Vérification mise à jour ──────────────────────────────────────────

ipcMain.handle('app:checkForUpdate', async () => {
  try {
    const fs = require('fs');
    const { getToken }      = require('./lib/token');
    const { AGENT_VERSION } = require('../shared/constants');
    const token = getToken();

    const configPath = app.isPackaged
      ? path.join(process.resourcesPath, 'service', 'dist', 'config.json')
      : path.join(__dirname, '..', 'service', 'config.json');
    if (!fs.existsSync(configPath)) return { hasUpdate: false };
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const platformUrl = cfg.platform_url || require('../shared/constants').PLATFORM_URL;

    const res = await axios.get(`${platformUrl}/api/v1/agent/check-update`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Agent-Version': AGENT_VERSION,
      },
      timeout: 8000,
    });
    return res.data;
  } catch (_) {
    return { hasUpdate: false };
  }
});

// ─── IPC : Téléchargement de la mise à jour ───────────────────────────────────

ipcMain.handle('app:downloadUpdate', async (_, { fileUrl, checksum }) => {
  const https  = require('https');
  const http   = require('http');
  const fs     = require('fs');
  const os     = require('os');
  const crypto = require('crypto');

  const tmpPath = path.join(os.tmpdir(), `cockpit-agent-update-${Date.now()}.exe`);

  return new Promise((resolve) => {
    const protocol = fileUrl.startsWith('https') ? https : http;
    const req = protocol.get(fileUrl, (res) => {
      if (res.statusCode !== 200) {
        return resolve({ success: false, error: `HTTP ${res.statusCode}` });
      }
      const total    = parseInt(res.headers['content-length'] || '0', 10);
      let received   = 0;
      const dest     = fs.createWriteStream(tmpPath);
      const hash     = crypto.createHash('sha256');

      res.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        if (total > 0 && _win && !_win.isDestroyed()) {
          _win.webContents.send('update:progress', { percent: Math.round((received / total) * 100) });
        }
      });
      res.pipe(dest);
      dest.on('finish', () => {
        const actual = hash.digest('hex');
        if (checksum && actual.toLowerCase() !== checksum.toLowerCase()) {
          try { fs.unlinkSync(tmpPath); } catch (_) {}
          return resolve({ success: false, error: `Checksum invalide.\nAttendu : ${checksum}\nObtenu  : ${actual}` });
        }
        resolve({ success: true, tmpPath });
      });
      dest.on('error', (err) => resolve({ success: false, error: err.message }));
    });
    req.on('error', (err) => resolve({ success: false, error: err.message }));
  });
});

// ─── IPC : Application de la mise à jour (UAC + stop/copy/start) ─────────────

ipcMain.handle('app:applyUpdate', async (_, { tmpPath }) => {
  if (!app.isPackaged) {
    return { success: false, error: 'Mise à jour non disponible en mode développement.' };
  }
  try {
    const fs  = require('fs');
    const os  = require('os');
    const { execFileSync } = require('child_process');

    if (!fs.existsSync(tmpPath)) {
      return { success: false, error: 'Fichier de mise à jour introuvable.' };
    }

    const servicePath = path.join(process.resourcesPath, 'service', 'dist', 'cockpit-agent-service.exe');
    const psScript    = path.join(os.tmpdir(), `cockpit-update-${Date.now()}.ps1`);

    // Escape backslashes pour PowerShell double-quoted string
    const esc = (s) => s.replace(/\\/g, '\\\\');
    const psContent = [
      `sc.exe stop ${SERVICE_NAME} | Out-Null`,
      `Start-Sleep -Seconds 3`,
      `Copy-Item -Path "${esc(tmpPath)}" -Destination "${esc(servicePath)}" -Force`,
      `sc.exe start ${SERVICE_NAME} | Out-Null`,
    ].join('\r\n');

    fs.writeFileSync(psScript, psContent, 'utf8');

    const q         = (s) => s.replace(/'/g, "''");
    const psScriptQ = q(psScript);

    execFileSync('powershell.exe', [
      '-NonInteractive', '-NoProfile', '-Command',
      `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden` +
      ` -ArgumentList @('-NonInteractive','-NoProfile','-ExecutionPolicy','Bypass','-File','"${psScriptQ}"');` +
      ` if ($p.ExitCode -ne 0) { throw "apply-update exit $($p.ExitCode)" }`,
    ], { windowsHide: false, timeout: 60000, encoding: 'utf8' });

    try { fs.unlinkSync(tmpPath);  } catch (_) {}
    try { fs.unlinkSync(psScript); } catch (_) {}

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
