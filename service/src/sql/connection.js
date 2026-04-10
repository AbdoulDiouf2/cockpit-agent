'use strict';

const sql    = require('mssql');
const config = require('../config');
const logger = require('../utils/logger');

let _pool = null;

/**
 * Retourne le pool de connexions mssql (singleton).
 * Crée le pool si besoin.
 */
async function getPool() {
  if (_pool && _pool.connected) return _pool;

  const cfg = config.load();

  const sqlConfig = {
    server:   cfg.sql_server,
    database: cfg.sql_database,
    options: {
      trustServerCertificate: true,
      enableArithAbort: true,
      instanceName: cfg.sql_instance || undefined,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 15000,
    requestTimeout:    30000,
  };

  if (cfg.sql_use_windows_auth) {
    sqlConfig.options.trustedConnection = true;
  } else {
    sqlConfig.user     = cfg.sql_user;
    sqlConfig.password = await require('../security/credential-store').getCredential('sql_password');
  }

  logger.info(`Connexion SQL Server : ${cfg.sql_server} / ${cfg.sql_database}`);
  _pool = await sql.connect(sqlConfig);
  logger.info('Pool SQL Server prêt');

  _pool.on('error', (err) => {
    logger.error('Erreur pool SQL :', err.message);
    _pool = null; // Force reconnexion au prochain appel
  });

  return _pool;
}

/**
 * Ferme le pool proprement (appelé au shutdown du service).
 */
async function closePool() {
  if (_pool) {
    await _pool.close();
    _pool = null;
    logger.info('Pool SQL Server fermé');
  }
}

/**
 * Teste la connexion sans ouvrir un pool persistant.
 */
async function testConnection(sqlConfig) {
  let testPool;
  try {
    testPool = await sql.connect({
      ...sqlConfig,
      pool: { max: 1, min: 0 },
      connectionTimeout: 10000,
    });
    await testPool.request().query('SELECT 1 AS ok');
    await testPool.close();
    return { success: true, serverVersion: testPool.config.options.serverVersion || 'N/A' };
  } catch (err) {
    if (testPool) await testPool.close().catch(() => {});
    return { success: false, error: err.message };
  }
}

module.exports = { getPool, closePool, testConnection, sql };
