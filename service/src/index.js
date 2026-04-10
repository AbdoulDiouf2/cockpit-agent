'use strict';

/**
 * Point d'entrée du service Windows Cockpit Agent.
 *
 * Architecture Zero-Copy :
 *  - Aucune donnée ERP n'est poussée vers le cloud
 *  - Les données sont fournies à la demande via WebSocket (execute_sql)
 *  - L'agent se connecte au backend, attend les requêtes, exécute et retourne
 */

const logger      = require('./utils/logger');
const health      = require('./utils/health');
const scheduler   = require('./scheduler');
const agentSocket = require('./ws/agent-socket');
const { closePool } = require('./sql/connection');
const { HEALTH_PORT, AGENT_VERSION } = require('../../shared/constants');

async function main() {
  logger.info('═══════════════════════════════════════════════');
  logger.info(` Cockpit Agent v${AGENT_VERSION} — démarrage`);
  logger.info(' Mode : Zero-Copy (données sur demande)');
  logger.info('═══════════════════════════════════════════════');

  // Démarrer le serveur de health check local
  health.start(HEALTH_PORT);
  health.setStatus({ ok: true, error: null });

  // Démarrer le planificateur (heartbeat uniquement)
  scheduler.start();

  // Connexion WebSocket vers la plateforme (execute_sql + logs temps réel)
  agentSocket.connect();

  logger.info('Agent opérationnel — en attente de requêtes');
}

async function shutdown(signal) {
  logger.info(`Signal ${signal} reçu — arrêt propre...`);
  scheduler.stop();
  agentSocket.disconnect();
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
