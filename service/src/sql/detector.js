'use strict';

const { sql } = require('./connection');
const logger  = require('../utils/logger');

/**
 * Détecte les capacités de la base Sage 100 connectée.
 * Interroge INFORMATION_SCHEMA pour éviter les erreurs de compilation SQL.
 *
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<SageCapabilities>}
 *
 * @typedef {Object} SageCapabilities
 * @property {number}  sqlServerVersion  - Version majeure SQL Server (ex: 16)
 * @property {string}  sageVersion       - "v21plus" | "v15v17" | "fallback"
 * @property {string}  stockSchema       - "v21plus" | "v15v17" | "fallback"
 * @property {string}  immoSchema        - "v21plus" | "v15v17" | "fallback"
 * @property {boolean} hasDateLivr       - F_DOCENTETE.DO_DateLivr présent
 * @property {boolean} hasFormatFunction - FORMAT() disponible (SQL >= 2012)
 * @property {string[]} tablesFound      - Tables Sage détectées
 * @property {number}  nbEcritures       - Nombre d'écritures comptables
 * @property {string}  detectedAt
 */
async function detectSageCapabilities(pool) {
  const result = {
    sqlServerVersion:  null,
    sageVersion:       null,
    stockSchema:       null,
    immoSchema:        null,
    hasDateLivr:       false,
    hasFormatFunction: false,
    tablesFound:       [],
    nbEcritures:       0,
    detectedAt:        new Date().toISOString(),
  };

  // Helper : teste l'existence d'une colonne dans INFORMATION_SCHEMA
  const hasColumn = async (table, column) => {
    const r = await pool.request()
      .input('t', sql.NVarChar, table)
      .input('c', sql.NVarChar, column)
      .query(`SELECT COUNT(*) AS n
              FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_NAME = @t AND COLUMN_NAME = @c`);
    return r.recordset[0].n > 0;
  };

  // 1. Version SQL Server
  const verRes = await pool.request()
    .query("SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS INT) AS v");
  result.sqlServerVersion  = verRes.recordset[0].v;
  result.hasFormatFunction = result.sqlServerVersion >= 11; // SQL Server 2012+

  // 2. Tables core Sage 100
  const coreRes = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME IN (
      'F_ECRITUREC','F_COMPTET','F_COMPTEG','F_JOURNAUX',
      'F_DOCENTETE','F_DOCLIGNE','F_ARTICLE','F_ARTSTOCK',
      'F_IMMOBILISATION','F_ECRITUREA','F_COMPTEA','F_ENUMANAL'
    )
    ORDER BY TABLE_NAME
  `);
  result.tablesFound = coreRes.recordset.map(r => r.TABLE_NAME);

  // 3. Schéma F_IMMOBILISATION (détermine la version Sage globale)
  if (await hasColumn('F_IMMOBILISATION', 'IM_ValAcq')) {
    result.immoSchema  = 'v21plus';
    result.sageVersion = 'v21plus';
  } else if (await hasColumn('F_IMMOBILISATION', 'IM_ValOrigine')) {
    result.immoSchema  = 'v15v17';
    result.sageVersion = 'v15v17';
  } else {
    result.immoSchema  = 'fallback';
    result.sageVersion = 'fallback';
  }

  // 4. Schéma F_ARTSTOCK
  if (await hasColumn('F_ARTSTOCK', 'AS_MontSto')) {
    result.stockSchema = 'v21plus';
  } else if (await hasColumn('F_ARTSTOCK', 'AS_PrixAch')) {
    result.stockSchema = 'v15v17';
  } else {
    result.stockSchema = 'fallback';
  }

  // 5. Champ optionnel DO_DateLivr (Sage 100 v19+)
  result.hasDateLivr = await hasColumn('F_DOCENTETE', 'DO_DateLivr');

  // 6. Nombre d'écritures (estimation volumétrie)
  try {
    const nbRes = await pool.request()
      .query('SELECT COUNT(*) AS NB FROM F_ECRITUREC');
    result.nbEcritures = nbRes.recordset[0].NB;
  } catch (_) {
    // Table peut ne pas exister encore
  }

  logger.info(`[detector] Sage détecté : ${result.sageVersion} | SQL Server ${result.sqlServerVersion} | ${result.nbEcritures} écritures`);
  return result;
}

module.exports = { detectSageCapabilities };
