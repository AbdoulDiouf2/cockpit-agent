'use strict';

/**
 * Planificateur du service Cockpit Agent.
 * - Sync : toutes les minutes (engine.run() détermine quelles vues sont dues)
 * - Heartbeat : toutes les 5 minutes
 */

const schedule = require('node-schedule');
const logger   = require('./utils/logger');
const health   = require('./utils/health');

let _syncJob      = null;
let _heartbeatJob = null;
let _pendingCommands = [];

function getPendingCommands() {
  const cmds = [..._pendingCommands];
  _pendingCommands = [];
  return cmds;
}

function queueCommand(cmd) {
  _pendingCommands.push(cmd);
}

function start() {
  const engine   = require('./sync/engine');
  const uploader = require('./sync/uploader');

  // Sync toutes les minutes
  _syncJob = schedule.scheduleJob('* * * * *', async () => {
    try {
      await engine.run();
    } catch (err) {
      logger.error(`[scheduler] Erreur cycle sync : ${err.message}`);
      health.setStatus({ ok: false, error: err.message });
    }
  });

  // Heartbeat toutes les 5 minutes
  _heartbeatJob = schedule.scheduleJob('*/5 * * * *', async () => {
    try {
      const { lastSync, totalSynced } = engine.getStats();
      const response = await uploader.sendHeartbeat('online', lastSync, totalSynced);

      if (response?.commands?.length > 0) {
        for (const cmd of response.commands) {
          logger.info(`[scheduler] Commande distante reçue : ${cmd}`);
          queueCommand(cmd);
        }
      }
    } catch (err) {
      logger.warn(`[scheduler] Heartbeat échoué : ${err.message}`);
    }
  });

  logger.info('[scheduler] Démarré — sync toutes les minutes, heartbeat toutes les 5 min');
}

function stop() {
  if (_syncJob)      { _syncJob.cancel();      _syncJob = null; }
  if (_heartbeatJob) { _heartbeatJob.cancel();  _heartbeatJob = null; }
  logger.info('[scheduler] Arrêté');
}

module.exports = { start, stop, getPendingCommands, queueCommand };
