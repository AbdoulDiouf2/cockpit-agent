'use strict';

/**
 * Serveur HTTP local — health check JSON + dashboard HTML.
 *
 * Routes :
 *   GET /         → dashboard HTML (auto-refresh 10s)
 *   GET /health   → JSON machine-readable (installeur, monitoring)
 */

const http   = require('http');
const os     = require('os');
const logger = require('./logger');

let _server    = null;
let _startedAt = Date.now();

// État global
let _status = {
  ok:                 false,
  lastSync:           null,
  error:              null,
  totalSynced:        0,
  sqlConnected:       false,
  platformConnected:  false,
  views:              {},        // { [viewName]: { lastSync, lastCount, mode, interval } }
};

function setStatus(patch) {
  Object.assign(_status, patch);
}

function setViewStatus(viewName, info) {
  _status.views[viewName] = { ...(_status.views[viewName] || {}), ...info };
}

// ─── HTML dashboard ───────────────────────────────────────────────────────────

function buildHtml(data) {
  const uptimeSec  = Math.floor((Date.now() - _startedAt) / 1000);
  const uptime     = formatUptime(uptimeSec);
  const statusOk   = data.status === 'ok';
  const statusColor = statusOk ? '#22c55e' : '#ef4444';
  const statusLabel = statusOk ? 'Opérationnel' : 'En erreur';
  const statusDot   = statusOk ? '🟢' : '🔴';

  const sqlColor      = data.sqlConnected      ? '#22c55e' : '#ef4444';
  const platformColor = data.platformConnected  ? '#22c55e' : '#f59e0b';
  const sqlLabel      = data.sqlConnected      ? 'Connecté'    : 'Déconnecté';
  const platformLabel = data.platformConnected  ? 'Connecté'   : 'En attente';

  const viewRows = Object.entries(data.views || {}).map(([name, v]) => {
    const synced = v.lastSync
      ? `<span style="color:#22c55e">✓ ${timeAgo(v.lastSync)}</span>`
      : `<span style="color:#94a3b8">—</span>`;
    const badge = v.mode === 'INCREMENTAL'
      ? `<span style="background:#1e3a5f;color:#93c5fd;padding:2px 8px;border-radius:4px;font-size:11px">INCRÉMENTAL</span>`
      : `<span style="background:#1e3a5f;color:#fcd34d;padding:2px 8px;border-radius:4px;font-size:11px">FULL</span>`;
    const count = v.lastCount != null
      ? `<span style="color:#cbd5e1">${v.lastCount.toLocaleString('fr-FR')} lignes</span>`
      : `<span style="color:#475569">—</span>`;
    return `
      <tr>
        <td style="padding:10px 16px;font-family:monospace;font-size:13px;color:#e2e8f0">${name}</td>
        <td style="padding:10px 16px;text-align:center">${badge}</td>
        <td style="padding:10px 16px;text-align:center;color:#64748b;font-size:13px">${v.interval || '—'} min</td>
        <td style="padding:10px 16px;text-align:right">${synced}</td>
        <td style="padding:10px 16px;text-align:right">${count}</td>
      </tr>`;
  }).join('');

  const errorBanner = data.error && !statusOk ? `
    <div style="background:#450a0a;border:1px solid #7f1d1d;border-radius:8px;padding:12px 16px;margin-bottom:24px;color:#fca5a5;font-size:13px">
      ⚠ ${escapeHtml(data.error)}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cockpit Agent — Statut</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    header {
      background: #1e293b;
      border-bottom: 1px solid #334155;
      padding: 16px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo { display: flex; align-items: center; gap: 12px; }
    .logo-icon {
      width: 36px; height: 36px;
      background: #3b66ac;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
    }
    .logo-text { font-size: 17px; font-weight: 600; color: #f1f5f9; }
    .logo-sub  { font-size: 12px; color: #64748b; margin-top: 1px; }
    .refresh-info { font-size: 12px; color: #475569; }
    main { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    .status-banner {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .status-dot {
      width: 14px; height: 14px;
      border-radius: 50%;
      background: ${statusColor};
      box-shadow: 0 0 8px ${statusColor};
      flex-shrink: 0;
    }
    .status-label { font-size: 20px; font-weight: 700; color: ${statusColor}; }
    .status-meta  { font-size: 13px; color: #64748b; margin-top: 2px; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 18px 20px;
    }
    .card-label { font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: #64748b; margin-bottom: 6px; }
    .card-value { font-size: 22px; font-weight: 700; color: #f1f5f9; }
    .card-sub   { font-size: 12px; color: #64748b; margin-top: 4px; }
    .section-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: .8px;
      color: #64748b;
      margin-bottom: 12px;
    }
    .table-wrap {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #0f172a; }
    thead th {
      padding: 10px 16px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .7px;
      color: #475569;
      text-align: left;
      font-weight: 600;
    }
    thead th:not(:first-child) { text-align: center; }
    thead th:last-child, thead th:nth-child(4) { text-align: right; }
    tbody tr { border-top: 1px solid #1e293b; }
    tbody tr:hover { background: #0f172a44; }
    .conn-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #334155;
      margin-top: 32px;
      padding-bottom: 24px;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">Cockpit Agent</div>
        <div class="logo-sub">Synchronisation Sage 100 → Cloud</div>
      </div>
    </div>
    <div class="refresh-info" id="refresh-countdown">Actualisation dans 10s</div>
  </header>

  <main>
    ${errorBanner}

    <div class="status-banner">
      <div class="status-dot"></div>
      <div>
        <div class="status-label">${statusLabel}</div>
        <div class="status-meta">
          Dernière sync : ${data.lastSync ? new Date(data.lastSync).toLocaleString('fr-FR') : 'jamais'}
          &nbsp;·&nbsp; Démarré ${uptime}
        </div>
      </div>
    </div>

    <div class="cards">
      <div class="card">
        <div class="card-label">Version</div>
        <div class="card-value">${escapeHtml(data.version)}</div>
        <div class="card-sub">Cockpit Agent</div>
      </div>
      <div class="card">
        <div class="card-label">Uptime</div>
        <div class="card-value">${uptime}</div>
        <div class="card-sub">Depuis le démarrage</div>
      </div>
      <div class="card">
        <div class="card-label">Total synchronisé</div>
        <div class="card-value">${(data.totalSynced || 0).toLocaleString('fr-FR')}</div>
        <div class="card-sub">Lignes envoyées</div>
      </div>
      <div class="card">
        <div class="card-label">SQL Server</div>
        <div class="card-value" style="font-size:15px;margin-top:4px">
          <span class="conn-pill" style="background:${data.sqlConnected ? '#14532d' : '#450a0a'};color:${sqlColor}">
            <span style="width:6px;height:6px;border-radius:50%;background:${sqlColor};display:inline-block"></span>
            ${sqlLabel}
          </span>
        </div>
        <div class="card-sub">Sage 100</div>
      </div>
      <div class="card">
        <div class="card-label">Plateforme</div>
        <div class="card-value" style="font-size:15px;margin-top:4px">
          <span class="conn-pill" style="background:${data.platformConnected ? '#14532d' : '#2d1f00'};color:${platformColor}">
            <span style="width:6px;height:6px;border-radius:50%;background:${platformColor};display:inline-block"></span>
            ${platformLabel}
          </span>
        </div>
        <div class="card-sub">Cockpit SaaS</div>
      </div>
    </div>

    ${Object.keys(data.views || {}).length > 0 ? `
    <div class="section-title">Vues synchronisées (${Object.keys(data.views).length})</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Vue</th>
            <th style="text-align:center">Mode</th>
            <th style="text-align:center">Intervalle</th>
            <th style="text-align:right">Dernier sync</th>
            <th style="text-align:right">Dernière batch</th>
          </tr>
        </thead>
        <tbody>${viewRows}</tbody>
      </table>
    </div>` : ''}

    <div class="footer">
      Cockpit Agent v${escapeHtml(data.version)} · ${escapeHtml(os.hostname())} ·
      <a href="/health" style="color:#3b66ac">JSON</a>
    </div>
  </main>

  <script>
    // Auto-refresh countdown
    let t = 10;
    const el = document.getElementById('refresh-countdown');
    const tick = setInterval(() => {
      t--;
      if (t <= 0) { clearInterval(tick); location.reload(); }
      else el.textContent = 'Actualisation dans ' + t + 's';
    }, 1000);
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatUptime(sec) {
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h < 24)     return `${h}h ${m}m`;
  return `${Math.floor(h / 24)}j ${h % 24}h`;
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5)    return 'à l\'instant';
  if (diff < 60)   return `il y a ${diff}s`;
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}m`;
  return `il y a ${Math.floor(diff / 3600)}h`;
}

// ─── Serveur HTTP ─────────────────────────────────────────────────────────────

function start(port) {
  if (_server) return;
  _startedAt = Date.now();

  const { AGENT_VERSION } = require('../../../shared/constants');

  _server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/health') {
      const payload = {
        status:            _status.ok ? 'ok' : 'error',
        lastSync:          _status.lastSync,
        error:             _status.error,
        totalSynced:       _status.totalSynced,
        sqlConnected:      _status.sqlConnected,
        platformConnected: _status.platformConnected,
        views:             _status.views,
        version:           AGENT_VERSION,
        uptime:            Math.floor((Date.now() - _startedAt) / 1000),
        ts:                new Date().toISOString(),
      };
      res.writeHead(_status.ok ? 200 : 503, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(payload, null, 2));

    } else if (url === '/') {
      const data = {
        status:            _status.ok ? 'ok' : 'error',
        lastSync:          _status.lastSync,
        error:             _status.error,
        totalSynced:       _status.totalSynced,
        sqlConnected:      _status.sqlConnected,
        platformConnected: _status.platformConnected,
        views:             _status.views,
        version:           AGENT_VERSION,
      };
      const html = buildHtml(data);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);

    } else {
      res.writeHead(404).end();
    }
  });

  _server.listen(port, '0.0.0.0', () => {
    logger.info(`Health dashboard démarré → http://127.0.0.1:${port}/`);
  });

  _server.on('error', (err) => {
    logger.warn(`Health server erreur (port ${port}) : ${err.message}`);
  });
}

function stop() {
  if (_server) { _server.close(); _server = null; }
}

module.exports = { start, stop, setStatus, setViewStatus };