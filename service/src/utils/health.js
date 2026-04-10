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
  wsConnected:        false,
  views:              {},   // { [viewName]: { lastSync, lastCount, mode, interval } }
  jobs:               {},   // stats jobs WS { jobsRun, jobsFailed, errorCount, lastError }
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
    .logo { display: flex; align-items: center; gap: 16px; }
    .logo-sub  { font-size: 12px; color: #64748b; margin-top: 4px; }
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
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" style="height:88px;width:auto;display:block;flex-shrink:0"><defs><style>.cls-1{fill:#ed6c23}.cls-2{fill:#f1f5f9}</style></defs><path class="cls-1" d="M178.31,987.13l3.89-.34a8.59,8.59,0,0,0,1.28,3.84,7,7,0,0,0,3.14,2.42,11.82,11.82,0,0,0,4.78.93,11.64,11.64,0,0,0,4.17-.7,5.81,5.81,0,0,0,2.69-1.93,4.43,4.43,0,0,0,.88-2.67,4,4,0,0,0-.85-2.56,6.33,6.33,0,0,0-2.81-1.84,56.66,56.66,0,0,0-5.54-1.52,27.9,27.9,0,0,1-6-1.94,8.47,8.47,0,0,1-3.33-2.9A7.13,7.13,0,0,1,179.5,974a7.87,7.87,0,0,1,1.34-4.41,8.3,8.3,0,0,1,3.91-3.11,14.79,14.79,0,0,1,5.72-1.06,15.67,15.67,0,0,1,6.11,1.11,8.86,8.86,0,0,1,4.07,3.29,9.4,9.4,0,0,1,1.53,4.91l-4,.3a6.42,6.42,0,0,0-2.16-4.47,8.39,8.39,0,0,0-5.43-1.51c-2.5,0-4.31.46-5.46,1.37a4.13,4.13,0,0,0-1.71,3.31,3.53,3.53,0,0,0,1.22,2.76q1.19,1.1,6.21,2.22a41.8,41.8,0,0,1,6.9,2,9.5,9.5,0,0,1,4,3.18,7.7,7.7,0,0,1,1.3,4.43,8.49,8.49,0,0,1-1.43,4.69,9.31,9.31,0,0,1-4.09,3.42,14.19,14.19,0,0,1-6,1.23,18,18,0,0,1-7.09-1.24,9.86,9.86,0,0,1-4.48-3.71A10.41,10.41,0,0,1,178.31,987.13Z"/><path class="cls-1" d="M215.57,997.15l12-31.17H232l12.75,31.17H240l-3.64-9.44h-13L220,997.15Zm9-12.8h10.56l-3.25-8.64q-1.49-3.93-2.21-6.46a40.36,40.36,0,0,1-1.68,6Z"/><path class="cls-1" d="M264,997.15,251.87,966h4.47l8.1,22.64c.65,1.81,1.19,3.52,1.63,5.1q.72-2.55,1.68-5.1L276.17,966h4.21l-12.2,31.17Z"/><path class="cls-1" d="M293.07,982q0-7.77,4.16-12.16A14.2,14.2,0,0,1,308,965.43a14.86,14.86,0,0,1,7.78,2.06,13.42,13.42,0,0,1,5.28,5.75,20,20,0,0,1-.09,16.85,13.07,13.07,0,0,1-5.42,5.66,15.42,15.42,0,0,1-7.57,1.93,14.71,14.71,0,0,1-7.87-2.13,13.69,13.69,0,0,1-5.25-5.8A17.63,17.63,0,0,1,293.07,982Zm4.25.06c0,3.76,1,6.71,3,8.88a10.56,10.56,0,0,0,15.26,0q3-3.27,3-9.29a15.92,15.92,0,0,0-1.29-6.64,9.84,9.84,0,0,0-3.76-4.4A10.2,10.2,0,0,0,308,969a10.58,10.58,0,0,0-7.54,3Q297.32,975,297.32,982Z"/><path class="cls-1" d="M339.13,997.15V966h4.12v31.17Z"/><path class="cls-1" d="M360.82,997.15V966h13.82a18.43,18.43,0,0,1,6.34.84,7,7,0,0,1,3.46,3,8.83,8.83,0,0,1,1.3,4.7,7.83,7.83,0,0,1-2.15,5.59q-2.14,2.28-6.63,2.89a11,11,0,0,1,2.49,1.56,21.43,21.43,0,0,1,3.42,4.14l5.42,8.49H383.1L379,990.66c-1.2-1.87-2.2-3.3-3-4.29a9.25,9.25,0,0,0-2.09-2.09,6.48,6.48,0,0,0-1.88-.83,13.26,13.26,0,0,0-2.3-.15H365v13.85ZM365,979.73h8.86a13.37,13.37,0,0,0,4.43-.58,4.68,4.68,0,0,0,2.42-1.87,5.09,5.09,0,0,0,.83-2.8,4.64,4.64,0,0,0-1.61-3.63q-1.61-1.43-5.07-1.43H365Z"/><path class="cls-1" d="M402.19,997.15v-4.36h4.36v4.36a7.83,7.83,0,0,1-.85,3.88,5.59,5.59,0,0,1-2.7,2.28l-1.07-1.64a3.59,3.59,0,0,0,1.79-1.56,6.67,6.67,0,0,0,.64-3Z"/><path class="cls-1" d="M466.29,986.22l4.13,1a13.9,13.9,0,0,1-4.67,7.75,12.86,12.86,0,0,1-8.24,2.67,14.89,14.89,0,0,1-8.2-2,12.84,12.84,0,0,1-4.8-6,21.16,21.16,0,0,1-1.65-8.35,18.39,18.39,0,0,1,1.86-8.5,12.75,12.75,0,0,1,5.3-5.5,15.39,15.39,0,0,1,7.56-1.88,12.75,12.75,0,0,1,7.86,2.38,12.39,12.39,0,0,1,4.45,6.69l-4.07,1a9.6,9.6,0,0,0-3.14-5,8.38,8.38,0,0,0-5.19-1.55,10,10,0,0,0-6,1.72,9.11,9.11,0,0,0-3.4,4.62,18.7,18.7,0,0,0-1,6,19.08,19.08,0,0,0,1.15,6.94,8.71,8.71,0,0,0,3.61,4.43,10.08,10.08,0,0,0,5.29,1.47,8.89,8.89,0,0,0,5.87-2A10.25,10.25,0,0,0,466.29,986.22Z"/><path class="cls-1" d="M484.25,970.1v-4.44h4.1v3.51a9.36,9.36,0,0,1-.66,4.1,5.78,5.78,0,0,1-2.85,2.59l-.93-1.51a3.35,3.35,0,0,0,1.71-1.47,6.41,6.41,0,0,0,.63-2.78Z"/><path class="cls-1" d="M504.2,997.15V966h22.54v3.68H508.33v9.54h17.24v3.66H508.33v10.61h19.13v3.68Z"/><path class="cls-1" d="M542,987.13l3.9-.34a8.59,8.59,0,0,0,1.28,3.84,7,7,0,0,0,3.14,2.42,11.82,11.82,0,0,0,4.78.93,11.68,11.68,0,0,0,4.17-.7,5.81,5.81,0,0,0,2.69-1.93,4.5,4.5,0,0,0,.88-2.67,4,4,0,0,0-.85-2.56,6.33,6.33,0,0,0-2.81-1.84,56.29,56.29,0,0,0-5.55-1.52,28,28,0,0,1-6-1.94,8.47,8.47,0,0,1-3.33-2.9,7.13,7.13,0,0,1-1.09-3.89,7.94,7.94,0,0,1,1.33-4.41,8.37,8.37,0,0,1,3.92-3.11,14.79,14.79,0,0,1,5.72-1.06,15.71,15.71,0,0,1,6.11,1.11,8.86,8.86,0,0,1,4.07,3.29,9.4,9.4,0,0,1,1.53,4.91l-4,.3a6.46,6.46,0,0,0-2.16-4.47,8.39,8.39,0,0,0-5.43-1.51q-3.75,0-5.46,1.37a4.13,4.13,0,0,0-1.71,3.31,3.52,3.52,0,0,0,1.21,2.76q1.2,1.1,6.22,2.22a42.12,42.12,0,0,1,6.9,2,9.5,9.5,0,0,1,4,3.18,7.77,7.77,0,0,1,1.3,4.43,8.49,8.49,0,0,1-1.43,4.69,9.31,9.31,0,0,1-4.09,3.42,14.19,14.19,0,0,1-6,1.23,18,18,0,0,1-7.09-1.24,9.86,9.86,0,0,1-4.48-3.71A10.5,10.5,0,0,1,542,987.13Z"/><path class="cls-1" d="M590.61,997.15V969.66H580.34V966H605v3.68H594.73v27.49Z"/><path class="cls-1" d="M639.53,997.15V966h11.76a28.14,28.14,0,0,1,4.74.3,9.44,9.44,0,0,1,3.85,1.45,7.71,7.71,0,0,1,2.5,3,9.7,9.7,0,0,1,.94,4.25,9.56,9.56,0,0,1-2.53,6.73c-1.69,1.84-4.73,2.75-9.14,2.75h-8v12.68Zm4.13-16.35h8.05q4,0,5.68-1.49a5.3,5.3,0,0,0,1.68-4.19,5.64,5.64,0,0,0-1-3.35,4.64,4.64,0,0,0-2.6-1.84,18.09,18.09,0,0,0-3.85-.27h-8Z"/><path class="cls-1" d="M679.51,997.15V966h4.13v31.17Z"/><path class="cls-1" d="M701,997.15V966h4.12v27.49h15.35v3.68Z"/><path class="cls-1" d="M734.35,982q0-7.77,4.17-12.16a14.16,14.16,0,0,1,10.75-4.38,14.86,14.86,0,0,1,7.78,2.06,13.5,13.5,0,0,1,5.29,5.75,18.7,18.7,0,0,1,1.81,8.36,18.36,18.36,0,0,1-1.91,8.49,13,13,0,0,1-5.42,5.66,15.42,15.42,0,0,1-7.57,1.93,14.68,14.68,0,0,1-7.86-2.13,13.65,13.65,0,0,1-5.26-5.8A17.63,17.63,0,0,1,734.35,982Zm4.25.06c0,3.76,1,6.71,3,8.88a10.57,10.57,0,0,0,15.27,0q3-3.27,3-9.29a16.09,16.09,0,0,0-1.28-6.64,9.92,9.92,0,0,0-3.77-4.4,10.2,10.2,0,0,0-5.56-1.56,10.54,10.54,0,0,0-7.53,3Q738.6,975,738.6,982Z"/><path class="cls-1" d="M787.64,997.15V969.66H777.37V966h24.7v3.68H791.76v27.49Z"/><path class="cls-1" d="M816.63,997.15V966h22.53v3.68H820.75v9.54H838v3.66H820.75v10.61h19.14v3.68Z"/><path class="cls-1" d="M855.89,997.15V966h13.82a18.36,18.36,0,0,1,6.33.84,7,7,0,0,1,3.47,3,8.91,8.91,0,0,1,1.29,4.7,7.83,7.83,0,0,1-2.14,5.59c-1.43,1.52-3.65,2.48-6.64,2.89a10.78,10.78,0,0,1,2.49,1.56,20.73,20.73,0,0,1,3.42,4.14l5.43,8.49h-5.19L874,990.66q-1.8-2.8-3-4.29a9.25,9.25,0,0,0-2.1-2.09,6.36,6.36,0,0,0-1.88-.83,13.21,13.21,0,0,0-2.29-.15H860v13.85ZM860,979.73h8.87a13.3,13.3,0,0,0,4.42-.58,4.68,4.68,0,0,0,2.42-1.87,5,5,0,0,0,.83-2.8,4.64,4.64,0,0,0-1.6-3.63q-1.61-1.43-5.07-1.43H860Z"/><path class="cls-1" d="M897.34,997.15v-4.36h4.35v4.36Z"/><path class="cls-2" d="M212.32,828.85l34.78,11q-8,29.08-26.6,43.21T173.3,897.2q-35.38,0-58.17-24.17T92.35,806.92q0-44.35,22.9-68.89t60.23-24.54q32.6,0,53,19.27,12.1,11.38,18.17,32.72L211.11,774Q208,760.15,198,752.15t-24.3-8q-19.75,0-32,14.18t-12.3,45.92q0,33.71,12.12,48t31.5,14.3a36,36,0,0,0,24.61-9.09Q207.83,848.38,212.32,828.85Z"/><path class="cls-2" d="M269.76,828a69.72,69.72,0,0,1,8.36-32.85,57.4,57.4,0,0,1,23.69-24.23,70.25,70.25,0,0,1,34.24-8.36q29.2,0,47.87,19t18.66,47.93q0,29.2-18.85,48.41t-47.44,19.21a74.61,74.61,0,0,1-33.75-8,54.9,54.9,0,0,1-24.42-23.44Q269.77,850.18,269.76,828Zm34.9,1.81q0,19.15,9.09,29.33a29.71,29.71,0,0,0,44.78,0q9-10.18,9-29.57,0-18.9-9-29.08a29.71,29.71,0,0,0-44.78,0Q304.66,810.67,304.66,829.82Z"/><path class="cls-2" d="M541.45,803.53l-33.56,6.06q-1.69-10.07-7.7-15.15t-15.57-5.09q-12.72,0-20.3,8.78t-7.57,29.39q0,22.9,7.69,32.36t20.67,9.45q9.69,0,15.87-5.51t8.72-19l33.45,5.7q-5.21,23-20,34.78t-39.63,11.75q-28.25,0-45-17.81T421.73,830q0-31.87,16.84-49.63t45.56-17.75q23.52,0,37.39,10.12T541.45,803.53Z"/><path class="cls-2" d="M566.05,894.17V716.52h34.06V810.8L640,765.48h41.93l-44,47,47.14,81.67H648.34L616,836.37,600.11,853v41.2Z"/><path class="cls-2" d="M704.32,765.48h31.76v18.9a47.42,47.42,0,0,1,16.72-15.75,46.08,46.08,0,0,1,23.39-6.06q22.41,0,38,17.57t15.63,49q0,32.24-15.75,50.11T776,897.08a43.32,43.32,0,0,1-19.33-4.24Q748,888.6,738.38,878.3v64.83H704.32ZM738,827.64q0,21.71,8.61,32.06t21,10.36q11.88,0,19.76-9.52t7.88-31.2q0-20.24-8.12-30.05T767,789.47a26.1,26.1,0,0,0-20.72,9.64Q738,808.74,738,827.64Z"/><path class="cls-2" d="M984.87,765.48v27.14H961.6v51.87q0,15.75.66,18.36a7.49,7.49,0,0,0,3,4.3,9.59,9.59,0,0,0,5.75,1.7q4.73,0,13.7-3.28l2.9,26.42a67.7,67.7,0,0,1-26.9,5.09,42.67,42.67,0,0,1-16.6-3.09q-7.39-3.09-10.85-8t-4.79-13.27q-1.08-5.93-1.09-24V792.62H911.79V765.48h15.63V739.91L961.6,720v45.45Z"/><path class="cls-2" d="M873.92,792a29.84,29.84,0,0,1-17-5.33V894.17H891V786.66A29.84,29.84,0,0,1,873.92,792Z"/><circle class="cls-1" cx="873.92" cy="762.03" r="17.52"/><path class="cls-1" d="M635,240.87A104.64,104.64,0,1,0,739.66,345.51,104.64,104.64,0,0,0,635,240.87Zm0,171.52a66.88,66.88,0,1,1,66.88-66.88A66.88,66.88,0,0,1,635,412.39Z"/><path class="cls-2" d="M513.48,207.07a185.64,185.64,0,0,1,269.23,20.45l63.9-60.25A274.23,274.23,0,0,0,642.14,76.69c-99.42,0-186.43,52.26-234.23,130.38Z"/><path class="cls-2" d="M784,461.94a185.64,185.64,0,0,1-270.48,22H407.91c47.8,78.12,134.81,130.38,234.23,130.38a274.52,274.52,0,0,0,205.75-91.91Z"/><path class="cls-2" d="M451.78,283.76h-74v21h68.18A191.66,191.66,0,0,1,451.78,283.76Z"/><circle class="cls-2" cx="366.68" cy="294.28" r="21.84"/><path class="cls-2" d="M481.07,229.11H343.76v21H467A191.36,191.36,0,0,1,481.07,229.11Z"/><path class="cls-2" d="M311.94,203.67a35.6,35.6,0,1,0,35.6,35.59A35.59,35.59,0,0,0,311.94,203.67Zm0,58a22.39,22.39,0,1,1,22.38-22.39A22.39,22.39,0,0,1,311.94,261.65Z"/><rect class="cls-2" x="298.45" y="336.08" width="139.52" height="21.04"/><path class="cls-2" d="M267.71,311a35.6,35.6,0,1,0,35.6,35.6A35.6,35.6,0,0,0,267.71,311Zm0,58a22.39,22.39,0,1,1,22.38-22.38A22.38,22.38,0,0,1,267.71,369Z"/><path class="cls-2" d="M466.94,440.72H339.83v21H480.94A191,191,0,0,1,466.94,440.72Z"/><path class="cls-2" d="M309.09,415.64a35.6,35.6,0,1,0,35.6,35.59A35.59,35.59,0,0,0,309.09,415.64Zm0,58a22.39,22.39,0,1,1,22.38-22.39A22.38,22.38,0,0,1,309.09,473.62Z"/><path class="cls-2" d="M445.8,385.7H377.74v21H451.6A191.44,191.44,0,0,1,445.8,385.7Z"/><circle class="cls-2" cx="366.68" cy="396.22" r="21.84"/></svg>
      <div>
        <div class="logo-sub" style="font-size:13px;color:#94a3b8;margin-top:0">Agent — Synchronisation Sage 100 → Cloud</div>
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

// ─── Helpers HTTP ─────────────────────────────────────────────────────────────

function _jsonRes(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'http://localhost, http://127.0.0.1',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body, null, 2));
}

function _readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

// ─── Serveur HTTP ─────────────────────────────────────────────────────────────

function start(port) {
  if (_server) return;
  _startedAt = Date.now();

  const { AGENT_VERSION } = require('../../../shared/constants');

  _server = http.createServer(async (req, res) => {
    const url    = req.url.split('?')[0];
    const method = req.method.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin':  'http://localhost, http://127.0.0.1',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    // ── GET /health ── JSON machine-readable (installeur, monitoring)
    if (url === '/health' && method === 'GET') {
      return _jsonRes(res, _status.ok ? 200 : 503, {
        status:            _status.ok ? 'ok' : 'error',
        lastSync:          _status.lastSync,
        error:             _status.error,
        totalSynced:       _status.totalSynced,
        sqlConnected:      _status.sqlConnected,
        platformConnected: _status.platformConnected,
        wsConnected:       _status.wsConnected || false,
        views:             _status.views,
        jobs:              _status.jobs || {},
        version:           AGENT_VERSION,
        uptime:            Math.floor((Date.now() - _startedAt) / 1000),
        ts:                new Date().toISOString(),
      });
    }

    // ── GET /ping ── health check enrichi (parité Python /ping)
    if (url === '/ping' && method === 'GET') {
      let sageOk = _status.sqlConnected;
      // Teste la connexion SQL en live si déjà établie
      try {
        const { getPool } = require('../sql/connection');
        const pool = await getPool();
        await pool.request().query('SELECT 1 AS ok');
        sageOk = true;
      } catch (_) { sageOk = false; }

      return _jsonRes(res, 200, {
        status:             _status.ok ? 'ok' : 'error',
        agent_name:         require('../config').get('agent_id') || 'CockpitAgent',
        version:            AGENT_VERSION,
        timestamp:          new Date().toISOString(),
        sage_connected:     sageOk,
        backend_registered: _status.platformConnected || false,
        ws_connected:       _status.wsConnected || false,
      });
    }

    // ── GET /status ── statut détaillé (parité Python /status)
    if (url === '/status' && method === 'GET') {
      let cfg = {};
      try { cfg = require('../config').load(); } catch (_) {}

      return _jsonRes(res, 200, {
        agent: {
          version:  AGENT_VERSION,
          uptime:   Math.floor((Date.now() - _startedAt) / 1000),
          hostname: os.hostname(),
        },
        sage: {
          connected: _status.sqlConnected,
          server:    cfg.sql_server   || null,
          database:  cfg.sql_database || null,
          windows_auth: cfg.sql_use_windows_auth || false,
        },
        backend: {
          registered:     _status.platformConnected || false,
          ws_connected:   _status.wsConnected || false,
          last_sync:      _status.lastSync,
          total_synced:   _status.totalSynced,
          error_count:    _status.jobs?.errorCount   || 0,
          last_error:     _status.jobs?.lastError     || null,
        },
        security: {
          allowed_tables: cfg.allowed_tables || [],
          max_rows:       cfg.max_rows       || 1000,
          rate_limit:     '10/minute',
        },
        views: _status.views,
      });
    }

    // ── POST /execute_sql ── exécution SQL locale directe (parité Python)
    if (url === '/execute_sql' && method === 'POST') {
      let body;
      try { body = await _readBody(req); }
      catch (e) { return _jsonRes(res, 400, { error: e.message, code: 'INVALID_JSON' }); }

      const { sql_query } = body;
      if (!sql_query) {
        return _jsonRes(res, 400, { error: 'sql_query requis', code: 'MISSING_PARAM' });
      }

      try {
        const { validate } = require('../jobs/sql-security');
        const cfg          = require('../config').load();
        const allowedTables = cfg.allowed_tables || [];
        const maxRows       = cfg.max_rows       || 1000;

        const sanitized = validate(sql_query, { allowedTables, maxRows });

        const { getPool }   = require('../sql/connection');
        const transformer   = require('../sync/transformer');

        const pool    = await getPool();
        const request = pool.request();
        request.timeout = (cfg.query_timeout || 5) * 1000;

        const start  = Date.now();
        const result = await request.query(sanitized);
        const execMs = Date.now() - start;

        const columns = result.recordset[0] ? Object.keys(result.recordset[0]) : [];
        const { records } = transformer.transform('__local__', result.recordset);

        return _jsonRes(res, 200, {
          result:   records,
          metadata: { rows: records.length, columns, exec_time_ms: execMs },
        });

      } catch (err) {
        const isSecurity = err.name === 'SQLSecurityError';
        logger.warn(`[health] /execute_sql refusé : ${err.message}`);
        return _jsonRes(res, isSecurity ? 403 : 400, {
          error: err.message,
          code:  isSecurity ? 'SECURITY_VIOLATION' : 'DATABASE_ERROR',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ── GET / ── Dashboard HTML
    if (url === '/' && method === 'GET') {
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
      return res.end(html);
    }

    res.writeHead(404).end();
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