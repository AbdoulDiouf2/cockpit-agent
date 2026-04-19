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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
      // En prod : installation Windows Service via node-windows
      await new Promise((resolve, reject) => {
        const svc = new Service({
          name:        SERVICE_NAME,
          description: SERVICE_DESCRIPTION,
          script:      servicePath,
        });

        const timeout = setTimeout(() => {
          reject(new Error("Timeout installation service (30s). Vérifiez que l'installeur est lancé en tant qu'Administrateur."));
        }, 30000);

        const done = () => { clearTimeout(timeout); resolve(); };
        const fail = (err) => { clearTimeout(timeout); reject(err); };

        svc.on('install',             () => { event.sender.send('service:progress', { step: 3, total: 5, label: 'Service installé, démarrage…' }); svc.start(); done(); });
        svc.on('alreadyinstalled',    () => { event.sender.send('service:progress', { step: 3, total: 5, label: 'Service déjà installé, redémarrage…' }); svc.start(); done(); });
        svc.on('invalidinstallation', () => fail(new Error('Installation invalide — supprimez le service existant et réessayez.')));
        svc.on('error', fail);

        svc.install();
      });
    }

    // 4. Attendre que le health check réponde (max 30s)
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      progress(4, 5, `Démarrage du service… (${i + 1}/30)`);
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
    return { success: false, error: err.message };
  }
});

// ─── IPC : Ouvrir le portail dans le navigateur ───────────────────────────────

ipcMain.handle('app:openDashboard', async () => {
  const url = process.env.COCKPIT_FRONT_URL || 'https://cockpit.nafakatech.com';
  await shell.openExternal(url);
});
