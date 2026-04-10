'use strict';

const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');
const { detectSageCapabilities } = require('./detector');

// Chemin vers les scripts SQL partagés (embarqués dans le build)
const SQL_DIR = path.join(__dirname, '..', '..', '..', 'shared', 'sql');

/**
 * Déploie les vues BI dans la base Sage 100.
 * Détecte la version Sage et choisit les bons fichiers SQL.
 *
 * @param {import('mssql').ConnectionPool} pool
 * @param {Function} [onProgress]  - Callback (step, total, current, status)
 * @returns {Promise<SageCapabilities>}
 */
async function deployViews(pool, onProgress) {
  logger.info('[deployer] Début détection capacités Sage...');
  const caps = await detectSageCapabilities(pool);
  logger.info('[deployer] Capacités :', caps);

  // Fichiers à exécuter dans l'ordre
  const files = [
    'deploy_common.sql',   // Tables PLATEFORME_PARAMS + index
    'views_stable.sql',    // 9 vues sans dépendance de version
    `views_${caps.immoSchema}.sql`, // Variante version : v21plus | v15v17 | fallback
  ];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    logger.info(`[deployer] Exécution : ${file}`);
    if (onProgress) onProgress(file, files.length, i + 1, 'running');

    await runSqlFile(pool, file);

    if (onProgress) onProgress(file, files.length, i + 1, 'done');
    logger.info(`[deployer] OK : ${file}`);
  }

  // Sauvegarder les capacités détectées dans PLATEFORME_PARAMS
  await saveCapabilities(pool, caps);

  logger.info('[deployer] Déploiement des vues terminé');
  return caps;
}

/**
 * Exécute un fichier SQL en découpant sur les séparateurs GO.
 * (GO n'est pas du SQL standard — le driver mssql ne le comprend pas nativement)
 */
async function runSqlFile(pool, filename) {
  const filePath = path.join(SQL_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Script SQL introuvable : ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const batches = content.split(/^\s*GO\s*$/im).filter(b => b.trim().length > 0);

  for (const batch of batches) {
    await pool.request().query(batch);
  }
}

/**
 * Persiste les capacités détectées dans PLATEFORME_PARAMS pour référence future.
 */
async function saveCapabilities(pool, caps) {
  const pairs = [
    ['SAGE_VERSION',        caps.sageVersion],
    ['SQL_SERVER_VERSION',  String(caps.sqlServerVersion)],
    ['STOCK_SCHEMA',        caps.stockSchema],
    ['IMMO_SCHEMA',         caps.immoSchema],
    ['HAS_DATE_LIVR',       caps.hasDateLivr ? '1' : '0'],
    ['HAS_FORMAT_FUNCTION', caps.hasFormatFunction ? '1' : '0'],
    ['NB_ECRITURES',        String(caps.nbEcritures)],
    ['DEPLOY_DATE',         caps.detectedAt],
    ['AGENT_VERSION',       require('../../shared/constants').AGENT_VERSION],
  ];

  for (const [key, value] of pairs) {
    await pool.request()
      .input('k', key)
      .input('v', value)
      .query(`
        IF EXISTS (SELECT 1 FROM PLATEFORME_PARAMS WHERE Param_Cle = @k)
          UPDATE PLATEFORME_PARAMS SET Param_Valeur = @v, Date_Modif = GETDATE() WHERE Param_Cle = @k
        ELSE
          INSERT INTO PLATEFORME_PARAMS (Param_Cle, Param_Valeur) VALUES (@k, @v)
      `);
  }
}

module.exports = { deployViews, runSqlFile };
