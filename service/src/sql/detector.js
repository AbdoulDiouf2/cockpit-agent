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
 * @property {number}   sqlServerVersion  - Version majeure SQL Server (ex: 16)
 * @property {string}   sageVersion       - "v21plus" | "v15v17" | "fallback"
 * @property {number|null} versionMajeure - Version majeure Sage (ex: 26, 19, 15)
 * @property {Array}    sageModules       - [{creator, type, version}] depuis cbSysTable
 * @property {string}   sageSource        - 'cbSysTable' | 'F_DOCENTETE columns' | 'F_COMPTET columns' | 'fallback'
 * @property {boolean}  hasDateLivr       - F_DOCENTETE.DO_DateLivr présent
 * @property {boolean}  hasFormatFunction - FORMAT() disponible (SQL >= 2012)
 * @property {string[]} tablesFound       - Tables Sage détectées
 * @property {number}   nbEcritures       - Nombre d'écritures comptables
 * @property {string}   detectedAt
 */

/**
 * Détection version Sage en cascade (3 niveaux).
 * Niveau 1 : cbSysTable (version exacte par module)
 * Niveau 2 : colonnes discriminantes F_DOCENTETE
 * Niveau 3 : colonnes discriminantes F_COMPTET
 */
async function detectSageVersion(pool) {
  const query = async (sqlText) => (await pool.request().query(sqlText)).recordset;

  const result = { version: 'fallback', versionMajeure: null, modules: [], source: 'fallback' };

  // Niveau 1 : cbSysTable
  try {
    const cbSys = await query(`
      IF OBJECT_ID('dbo.cbSysTable') IS NOT NULL
        SELECT CB_Creator, CB_Type, CB_CBaseVersion, CB_DescVersion
        FROM dbo.cbSysTable
    `);
    if (cbSys && cbSys.length > 0) {
      result.source  = 'cbSysTable';
      result.modules = cbSys.map(r => ({
        creator: r.CB_Creator,
        type:    r.CB_Type,
        version: Math.round(r.CB_DescVersion / 65536),
      }));
      const maxVersion      = Math.max(...result.modules.map(m => m.version));
      result.versionMajeure = maxVersion;
      result.version        = maxVersion >= 21 ? 'v21plus' : 'v15v17';
      return result;
    }
  } catch (_) {}

  // Niveau 2 : colonnes F_DOCENTETE
  try {
    const cols = await query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'F_DOCENTETE'
        AND COLUMN_NAME IN ('DO_NombreUM','DO_DateLivr','DO_TypeFrais','DO_DateDepart')
    `);
    if (cols && cols.length > 0) {
      result.source = 'F_DOCENTETE columns';
      const names = cols.map(r => r.COLUMN_NAME);
      if (names.includes('DO_NombreUM'))   { result.version = 'v21plus'; result.versionMajeure = 21; return result; }
      if (names.includes('DO_DateLivr'))   { result.version = 'v21plus'; result.versionMajeure = 19; return result; }
      if (names.includes('DO_TypeFrais'))  { result.version = 'v15v17';  result.versionMajeure = 17; return result; }
      if (names.includes('DO_DateDepart')) { result.version = 'v15v17';  result.versionMajeure = 15; return result; }
    }
  } catch (_) {}

  // Niveau 3 : colonnes F_COMPTET
  try {
    const cols2 = await query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'F_COMPTET'
        AND COLUMN_NAME IN ('CT_NomPayeur','CT_SEPA','CT_IBAN')
    `);
    if (cols2 && cols2.length > 0) {
      result.source = 'F_COMPTET columns';
      const names2 = cols2.map(r => r.COLUMN_NAME);
      if (names2.includes('CT_NomPayeur')) { result.version = 'v21plus'; result.versionMajeure = 21; return result; }
      if (names2.includes('CT_SEPA'))      { result.version = 'v21plus'; result.versionMajeure = 19; return result; }
      if (names2.includes('CT_IBAN'))      { result.version = 'v15v17';  result.versionMajeure = 17; return result; }
    }
  } catch (_) {}

  // Niveau 4 : F_IMMOBILISATION + F_ARTSTOCK (logique historique)
  try {
    const immo = await query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'F_IMMOBILISATION'
        AND COLUMN_NAME IN ('IM_ValAcq','IM_ValOrigine')
    `);
    if (immo && immo.length > 0) {
      result.source = 'F_IMMOBILISATION columns';
      const names3 = immo.map(r => r.COLUMN_NAME);
      if (names3.includes('IM_ValAcq'))     { result.version = 'v21plus'; return result; }
      if (names3.includes('IM_ValOrigine')) { result.version = 'v15v17';  return result; }
    }
  } catch (_) {}

  try {
    const artstock = await query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'F_ARTSTOCK'
        AND COLUMN_NAME IN ('AS_MontSto','AS_PrixAch')
    `);
    if (artstock && artstock.length > 0) {
      result.source = 'F_ARTSTOCK columns';
      const names4 = artstock.map(r => r.COLUMN_NAME);
      if (names4.includes('AS_MontSto')) { result.version = 'v21plus'; return result; }
      if (names4.includes('AS_PrixAch')) { result.version = 'v15v17';  return result; }
    }
  } catch (_) {}

  return result;
}

async function detectSageCapabilities(pool) {
  const result = {
    sqlServerVersion:  null,
    sageVersion:       null,
    versionMajeure:    null,
    sageModules:       [],
    sageSource:        null,
    hasDateLivr:       false,
    hasFormatFunction: false,
    tablesFound:       [],
    nbEcritures:       0,
    detectedAt:        new Date().toISOString(),
  };

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
  result.hasFormatFunction = result.sqlServerVersion >= 11;

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

  // 3. Détection version Sage (cascade 3 niveaux)
  const vd = await detectSageVersion(pool);
  result.sageVersion    = vd.version;
  result.versionMajeure = vd.versionMajeure;
  result.sageModules    = vd.modules;
  result.sageSource     = vd.source;

  // 4. Champ optionnel DO_DateLivr (Sage 100 v19+)
  result.hasDateLivr = await hasColumn('F_DOCENTETE', 'DO_DateLivr');

  // 5. Nombre d'écritures (estimation volumétrie)
  try {
    const nbRes = await pool.request()
      .query('SELECT COUNT(*) AS NB FROM F_ECRITUREC');
    result.nbEcritures = nbRes.recordset[0].NB;
  } catch (_) {}

  logger.info(
    `[detector] Sage ${result.sageVersion} (v${result.versionMajeure ?? '?'}) ` +
    `via ${result.sageSource} | ` +
    `Modules: ${result.sageModules.map(m => m.type).join(', ') || 'N/A'} | ` +
    `SQL Server ${result.sqlServerVersion} | ${result.nbEcritures} écritures`
  );
  return result;
}

module.exports = { detectSageCapabilities };
