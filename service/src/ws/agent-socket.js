'use strict';

/**
 * Client WebSocket Socket.IO — Namespace /agents
 *
 * Connexion sortante vers api.cockpit.app/agents.
 * Auth via handshake.auth.token (token agent isag_...).
 *
 * Événements reçus :
 *   authenticated  → { organizationId, agentId }
 *   execute_sql    → { jobId, sql, timeout? }
 *
 * Événements émis :
 *   agent_config   → { sageType, sageMode, sageHost, sagePort, sageVersion, sqlServer }
 *   sql_result     → { jobId, result?, error?, metadata? }
 *   agent_log      → { level, message, timestamp }
 *
 * Socket.IO gère la reconnexion automatiquement (backoff exponentiel).
 */

const { io }    = require('socket.io-client');
const { getToken, saveToken, getPlatformUrl } = require('../security/token');
const { getPool }      = require('../sql/connection');
const transformer      = require('../sync/transformer');
const { validate, SQLSecurityError } = require('../jobs/sql-security');
const health           = require('../utils/health');
const logger           = require('../utils/logger');
const config           = require('../config');
const { AGENT_VERSION } = require('../../../shared/constants');

let _socket = null;

// Stats exposées dans le dashboard et le heartbeat
let _stats = {
  connected:  false,
  jobsRun:    0,
  jobsFailed: 0,
  lastJobAt:  null,
  errorCount: 0,
  lastError:  null,
};

// ─── Exécution SQL ────────────────────────────────────────────────────────────

async function _execute(sql, timeout = 30) {
  // Charger la config sécurité depuis config.json
  const cfg          = config.load();
  const allowedTables = cfg.allowed_tables || [];
  const maxRows       = cfg.max_rows       || 1000;

  // Valider + sanitiser (whitelist tables, TOP, keywords, commentaires…)
  const sanitizedSql = validate(sql, { allowedTables, maxRows });

  const pool    = await getPool();
  const request = pool.request();
  request.timeout = timeout * 1000;

  const startedAt = Date.now();
  const result    = await request.query(sanitizedSql);
  const durationMs = Date.now() - startedAt;

  const columns = result.recordset.columns
    ? Object.keys(result.recordset.columns)
    : (result.recordset[0] ? Object.keys(result.recordset[0]) : []);

  const { records } = transformer.transform('__job__', result.recordset);

  return {
    rows:     records,
    metadata: {
      rows:         records.length,
      columns,
      exec_time_ms: durationMs,
    },
  };
}

// ─── Connexion ────────────────────────────────────────────────────────────────

function connect() {
  if (_socket?.connected) return;

  let token, baseUrl;
  try {
    token   = getToken();
    baseUrl = getPlatformUrl();
  } catch (err) {
    logger.warn(`[ws] Impossible de lire le token — WebSocket différé : ${err.message}`);
    return;
  }

  _socket = io(`${baseUrl}/agents`, {
    auth:               { token },
    transports:         ['websocket'],
    reconnectionDelay:  2000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
    timeout:            10000,
  });

  // ─── Événements système ───────────────────────────────────────────────────

  _socket.on('connect', () => {
    logger.info(`[ws] Connecté au namespace /agents (id=${_socket.id})`);
  });

  _socket.on('authenticated', ({ organizationId, agentId }) => {
    logger.info(`[ws] Authentifié — org=${organizationId} agent=${agentId}`);
    _stats.connected = true;
    health.setStatus({ wsConnected: true, platformConnected: true });
    sendLog('info', `Agent authentifié et prêt pour l'organisation ${organizationId}`);

    // Envoyer la configuration Sage locale au backend pour éviter la double saisie
    // lors de l'onboarding (le backend met à jour l'organisation et auto-complète le step 3)
    _sendAgentConfig();
  });

  // ─── token_renewal ────────────────────────────────────────────────────────
  // Reçu quand le backend renouvelle automatiquement le token (J-7 avant expiration).
  // On persiste le nouveau token chiffré puis on force une reconnexion pour l'activer.
  _socket.on('token_renewal', ({ newToken, expiresAt }) => {
    try {
      saveToken(newToken);
      logger.info(`[ws] Token renouvelé automatiquement. Expire le ${expiresAt}`);
      sendLog('info', `Token renouvelé automatiquement par la plateforme (expire le ${expiresAt})`);
    } catch (err) {
      logger.error(`[ws] Impossible de sauvegarder le nouveau token : ${err.message}`);
      return;
    }
    // Reconnexion avec le nouveau token après un court délai
    setTimeout(() => {
      if (_socket) {
        _socket.disconnect();
        _socket = null;
      }
      connect();
    }, 1500);
  });

  _socket.on('disconnect', (reason) => {
    logger.warn(`[ws] Déconnecté : ${reason}`);
    _stats.connected = false;
    health.setStatus({ wsConnected: false, platformConnected: false });
    sendLog('warning', 'Agent déconnecté du WebSocket');
  });

  _socket.on('connect_error', (err) => {
    logger.warn(`[ws] Erreur connexion : ${err.message}`);
    _stats.connected = false;
    health.setStatus({ wsConnected: false, platformConnected: false });
  });

  // ─── execute_sql ──────────────────────────────────────────────────────────

  _socket.on('execute_sql', async ({ jobId, sql, timeout }) => {
    logger.info(`[ws] execute_sql job=${jobId} — ${String(sql).substring(0, 80).replace(/\n/g, ' ')}…`);

    try {
      const { rows, metadata } = await _execute(sql, timeout);

      _socket.emit('sql_result', { jobId, result: rows, metadata });

      _stats.jobsRun++;
      _stats.lastJobAt = new Date().toISOString();
      _stats.errorCount = 0;
      _stats.lastError  = null;
      health.setStatus({ jobs: _stats });

      logger.info(`[ws] job=${jobId} terminé — ${metadata.rows} lignes en ${metadata.exec_time_ms}ms`);

    } catch (err) {
      // Sérialisation robuste : err.message peut être un objet (erreurs ODBC msnodesqlv8)
      let msg;
      if (typeof err?.message === 'string') {
        msg = err.message;
      } else if (err?.message !== undefined) {
        try { msg = JSON.stringify(err.message); } catch (_) { msg = String(err.message); }
      } else if (err instanceof Error) {
        msg = err.toString();
      } else {
        try { msg = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})); } catch (_) { msg = String(err); }
      }

      // Log complet (objets imbriqués inclus) pour faciliter le diagnostic
      logger.error(`[ws] execute_sql job=${jobId} échoué : ${msg} — raw: ${JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}))}`);

      _socket.emit('sql_result', { jobId, error: msg });

      _stats.jobsFailed++;
      _stats.errorCount++;
      _stats.lastError = msg;
      health.setStatus({ jobs: _stats });

      sendLog('error', `Échec SQL job ${jobId} : ${msg}`);
    }
  });
}

// ─── Envoi de la config Sage au backend (onboarding auto-complete) ───────────

function _sendAgentConfig() {
  if (!_socket?.connected) return;
  try {
    const cfg = config.load();

    // Construire la chaîne sqlServer (ex: "MONSERVEUR\SAGE" ou "192.168.1.10,1433")
    const sqlServer = cfg.sql_instance
      ? `${cfg.sql_server}\\${cfg.sql_instance}`
      : cfg.sql_server || null;

    _socket.emit('agent_config', {
      sageType:    cfg.sage_type    || null,  // ex: "100" ou "X3" — stocké lors de l'installation
      sageMode:    'local',                   // l'agent est toujours on-premise
      sageHost:    cfg.sql_server   || null,
      sagePort:    cfg.sql_port     || null,
      sageVersion: cfg.sage_version || null,  // ex: "v21plus" — détecté lors de l'installation
      sqlServer,
    });
    logger.info('[ws] agent_config envoyé au backend');
  } catch (err) {
    logger.warn(`[ws] Impossible d'envoyer agent_config : ${err.message}`);
  }
}

// ─── Envoi de logs vers la plateforme ────────────────────────────────────────

function sendLog(level, message) {
  if (!_socket?.connected) return;
  try {
    _socket.emit('agent_log', {
      level,
      message,
      timestamp: new Date().toISOString(),
    });
  } catch (_) {}
}

function disconnect() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

function getStats() {
  return { ..._stats };
}

module.exports = { connect, disconnect, sendLog, getStats };
