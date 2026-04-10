'use strict';

/**
 * Point d'entrée du service Windows Cockpit Agent.
 * Ce fichier est lancé par node-windows au démarrage du service.
 */

const logger    = require('./utils/logger');
const health    = require('./utils/health');
const scheduler = require('./scheduler');
const engine    = require('./sync/engine');
const { closePool } = require('./sql/connection');
const { HEALTH_PORT, AGENT_VERSION } = require('../../shared/constants');

async function main() {
  logger.info('═══════════════════════════════════════════════');
  logger.info(` Cockpit Agent v${AGENT_VERSION} — démarrage`);
  logger.info('═══════════════════════════════════════════════');

  // Démarrer le serveur de health check local
  health.start(HEALTH_PORT);
  health.setStatus({ ok: false, error: 'Initialisation en cours...' });

  // Pré-remplir le tableau des vues (affichage immédiat dans le dashboard)
  const { VIEWS } = require('../../shared/constants');
  for (const [name, cfg] of Object.entries(VIEWS)) {
    health.setViewStatus(name, { mode: cfg.mode, interval: cfg.interval, lastSync: null, lastCount: null });
  }

  // Démarrer le planificateur (sync + heartbeat)
  scheduler.start();

  // Marquer comme opérationnel immédiatement (avant fetchRemoteConfig qui peut être lent)
  health.setStatus({ ok: true, error: null });

  // Récupérer la configuration distante en arrière-plan (non-bloquant)
  engine.fetchRemoteConfig();
  logger.info('Agent opérationnel — synchronisation active');
}

// Gestion du shutdown propre (SIGTERM envoyé par node-windows à l'arrêt du service)
async function shutdown(signal) {
  logger.info(`Signal ${signal} reçu — arrêt propre...`);
  scheduler.stop();
  await closePool();
  health.stop();
  logger.info('Cockpit Agent arrêté proprement');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error(`Exception non gérée : ${err.message}`, err);
  health.setStatus({ ok: false, error: err.message });
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Promise non gérée : ${reason}`);
});

main().catch((err) => {
  logger.error(`Erreur fatale au démarrage : ${err.message}`);
  process.exit(1);
});
