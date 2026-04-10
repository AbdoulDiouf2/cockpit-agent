'use strict';

/**
 * Planificateur du service Cockpit Agent.
 *
 * Architecture Zero-Copy : aucune donnée ERP n'est poussée vers le cloud.
 * Les données sont fournies à la demande via WebSocket (execute_sql).
 *
 * - Heartbeat : toutes les 5 minutes → signale que l'agent est vivant
 */

const schedule = require('node-schedule');
const logger   = require('./utils/logger');
const health   = require('./utils/health');

let _heartbeatJob = null;

function start() {
  const uploader = require('./sync/uploader');

  // Heartbeat toutes les minutes (seuil offline backend = 2 min)
  _heartbeatJob = schedule.scheduleJob('* * * * *', async () => {
    try {
      const wsStats = require('./ws/agent-socket').getStats();
      const status  = wsStats.errorCount > 0 ? 'error' : 'online';

      await uploader.sendHeartbeat(status, null, 0, {
        errorCount: wsStats.errorCount,
        lastError:  wsStats.lastError,
      });
      health.setStatus({ platformConnected: true });

    } catch (err) {
      health.setStatus({ platformConnected: false });
      logger.warn(`[scheduler] Heartbeat échoué : ${err.message}`);

      // Re-connexion WS automatique si token invalide (401/403) ou socket déconnecté
      const isAuthError = err.response?.status === 401 || err.response?.status === 403;
      const agentSocket = require('./ws/agent-socket');
      if (isAuthError || !agentSocket.getStats().connected) {
        logger.info('[scheduler] Tentative de reconnexion WebSocket…');
        agentSocket.disconnect();
        agentSocket.connect();
      }
    }
  });

  logger.info('[scheduler] Démarré — heartbeat 1min (mode Zero-Copy)');
}

function stop() {
  if (_heartbeatJob) { _heartbeatJob.cancel(); _heartbeatJob = null; }
  logger.info('[scheduler] Arrêté');
}

module.exports = { start, stop };
