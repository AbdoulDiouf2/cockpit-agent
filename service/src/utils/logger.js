'use strict';

const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = process.env.COCKPIT_LOG_DIR
  || path.join(process.execPath, '..', 'logs');

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
  ],
});

module.exports = logger;
