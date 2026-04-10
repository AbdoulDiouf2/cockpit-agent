'use strict';

const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = process.env.COCKPIT_LOG_DIR
  || path.join(process.execPath, '..', 'logs');

// Transport Winston → WebSocket (agent_log)
// Chargé en lazy pour éviter la dépendance circulaire au démarrage.
const WinstonTransport = require('winston-transport');
class SocketTransport extends WinstonTransport {
  log(info, callback) {
    // On n'envoie que WARN et ERROR vers la plateforme pour ne pas saturer
    if (info.level === 'warn' || info.level === 'error') {
      try {
        // Require lazy — le module n'est disponible qu'après index.js
        const { sendLog } = require('../ws/agent-socket');
        sendLog(info.level, info.message);
      } catch (_) { /* socket non initialisé — on ignore silencieusement */ }
    }
    callback();
  }
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) =>
      stack
        ? `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`
        : `${timestamp} [${level.toUpperCase()}] ${message}`
    )
  ),
  transports: [
    // Console (visible dans le journal Windows Event Viewer via node-windows)
    new winston.transports.Console(),
    // Fichier rotatif journalier, 30 jours de rétention
    new winston.transports.DailyRotateFile({
      dirname:       LOG_DIR,
      filename:      'cockpit-agent-%DATE%.log',
      datePattern:   'YYYY-MM-DD',
      maxFiles:      '30d',
      zippedArchive: true,
    }),
    // WebSocket → plateforme (WARN + ERROR uniquement)
    new SocketTransport(),
  ],
});

module.exports = logger;
