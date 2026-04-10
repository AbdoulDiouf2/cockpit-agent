'use strict';

/**
 * Serveur HTTP local minimal pour le health check.
 * Utilisé par l'installeur (Step 6) pour vérifier que le service est démarré,
 * et par les outils de monitoring (Nagios, Zabbix...).
 */

const http   = require('http');
const logger = require('./logger');

let _server = null;
let _status = { ok: false, lastSync: null, error: null };

function setStatus(patch) {
  Object.assign(_status, patch);
}

function start(port) {
  if (_server) return;

  _server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(_status.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status:   _status.ok ? 'ok' : 'error',
        lastSync: _status.lastSync,
        error:    _status.error,
        version:  require('../../../shared/constants').AGENT_VERSION,
        ts:       new Date().toISOString(),
      }));
    } else {
      res.writeHead(404).end();
    }
  });

  _server.listen(port, '127.0.0.1', () => {
    logger.info(`Health server démarré sur http://127.0.0.1:${port}/health`);
  });

  _server.on('error', (err) => {
    logger.warn(`Health server erreur (port ${port}) : ${err.message}`);
  });
}

function stop() {
  if (_server) {
    _server.close();
    _server = null;
  }
}

module.exports = { start, stop, setStatus };
