'use strict';

/**
 * Gestion des watermarks de synchronisation incrémentale.
 *
 * cbMarq est un entier auto-incrémenté par Sage 100 à chaque
 * création/modification d'enregistrement. C'est notre curseur de sync :
 * on mémorise le dernier cbMarq traité et on ne récupère ensuite que
 * les enregistrements dont le cbMarq est supérieur.
 *
 * Les watermarks sont persistés dans PLATEFORME_PARAMS (table créée par deploy_common.sql).
 */

const logger = require('../utils/logger');

const KEY_PREFIX = 'WATERMARK_';

/**
 * Retourne le watermark actuel pour une vue.
 * Retourne 0 si aucun watermark enregistré (première sync = FULL).
 *
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} viewName
 * @returns {Promise<number>}
 */
async function get(pool, viewName) {
  try {
    const res = await pool.request()
      .input('k', `${KEY_PREFIX}${viewName}`)
      .query(`SELECT Param_Valeur FROM PLATEFORME_PARAMS WHERE Param_Cle = @k`);

    if (res.recordset.length > 0) {
      return parseInt(res.recordset[0].Param_Valeur, 10) || 0;
    }
    return 0;
  } catch (err) {
    logger.warn(`[watermark] Impossible de lire le watermark de ${viewName} : ${err.message}`);
    return 0;
  }
}

/**
 * Persiste un nouveau watermark pour une vue.
 *
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} viewName
 * @param {number} value
 */
async function set(pool, viewName, value) {
  const key = `${KEY_PREFIX}${viewName}`;
  await pool.request()
    .input('k', key)
    .input('v', String(value))
    .query(`
      IF EXISTS (SELECT 1 FROM PLATEFORME_PARAMS WHERE Param_Cle = @k)
        UPDATE PLATEFORME_PARAMS SET Param_Valeur = @v, Date_Modif = GETDATE() WHERE Param_Cle = @k
      ELSE
        INSERT INTO PLATEFORME_PARAMS (Param_Cle, Param_Valeur) VALUES (@k, @v)
    `);
}

/**
 * Réinitialise le watermark d'une vue (force une resync complète au prochain cycle).
 */
async function reset(pool, viewName) {
  await set(pool, viewName, 0);
  logger.info(`[watermark] Reset watermark ${viewName} → 0 (prochaine sync sera FULL)`);
}

module.exports = { get, set, reset };
