'use strict';

const sql             = require('mssql');
const config          = require('../config');
const logger          = require('../utils/logger');
const credentialStore = require('../security/credential-store');

// msnodesqlv8 : driver natif ODBC requis pour Windows Integrated Security
let sqlOdbc = null;
try { sqlOdbc = require('mssql/msnodesqlv8'); } catch (_) {}

let _pool = null;

/**
 * Retourne le pool de connexions mssql (singleton).
 * Crée le pool si besoin.
 */
async function getPool() {
  if (_pool && _pool.connected) return _pool;

  const cfg = config.load();

  logger.info(`Connexion SQL Server : ${cfg.sql_server}${cfg.sql_port ? `:${cfg.sql_port}` : ''} / ${cfg.sql_database}`);

  if (cfg.sql_use_windows_auth) {
    // tedious ne supporte pas SSPI — on passe par l'ODBC Driver natif Windows
    if (!sqlOdbc) throw new Error('msnodesqlv8 requis pour Windows Auth — lancez : npm install msnodesqlv8');

    const serverStr = cfg.sql_instance
      ? `${cfg.sql_server}\\${cfg.sql_instance}`
      : (cfg.sql_port ? `${cfg.sql_server},${cfg.sql_port}` : cfg.sql_server);

    const connStr = `Driver={ODBC Driver 17 for SQL Server};Server=${serverStr};Database=${cfg.sql_database};Trusted_Connection=yes;TrustServerCertificate=yes;`;
    _pool = await sqlOdbc.connect({
      connectionString: connStr,
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    });
  } else {
    const sqlConfig = {
      server:   cfg.sql_server,
      database: cfg.sql_database,
      user:     cfg.sql_user,
      password: await credentialStore.getCredential('sql_password'),
      options: {
        trustServerCertificate: true,
        enableArithAbort: true,
        instanceName: cfg.sql_instance || undefined,
      },
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 15000,
      requestTimeout:    30000,
    };
    if (cfg.sql_port) sqlConfig.port = cfg.sql_port;
    _pool = await sql.connect(sqlConfig);
  }
  logger.info('Pool SQL Server prêt');
  require('../utils/health').setStatus({ sqlConnected: true });

  _pool.on('error', (err) => {
    logger.error('Erreur pool SQL :', err.message);
    require('../utils/health').setStatus({ sqlConnected: false });
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
