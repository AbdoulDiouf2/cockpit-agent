'use strict';

/**
 * Moteur de synchronisation incrémentale Sage 100 → Cockpit SaaS.
 *
 * Pour chaque vue configurée :
 *   1. Lit le dernier watermark (cbMarq) depuis PLATEFORME_PARAMS
 *   2. Extrait les lignes nouvelles/modifiées depuis la vue
 *   3. Transforme les données
 *   4. Uploade vers POST /api/v1/agent/ingest
 *   5. Met à jour le watermark
 */

const { getPool }    = require('../sql/connection');
const watermark      = require('./watermark');
const transformer    = require('./transformer');
const uploader       = require('./uploader');
const health         = require('../utils/health');
const logger         = require('../utils/logger');
const { VIEWS }      = require('../../../shared/constants');
const config         = require('../config');

// Suivi de la dernière synchronisation réussie
let _lastSync      = null;
let _totalSynced   = 0;
let _remoteConfig  = null; // Config récupérée depuis l'API (intervalles, vues activées)

// Cache du nom de colonne watermark par vue (détecté une fois au premier cycle)
const _wmColCache  = {};

/**
 * Détecte le nom de la colonne watermark dans une vue.
 * Priorité : Watermark_Sync > watermark_sync > cbMarq — retourne null si vue FULL sans watermark.
 */
async function resolveWatermarkColumn(pool, viewName) {
  if (_wmColCache[viewName] !== undefined) return _wmColCache[viewName];

  const res = await pool.request()
    .input('v', viewName)
    .query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = @v
              AND COLUMN_NAME IN ('Watermark_Sync','watermark_sync','cbMarq','Watermark_sync')`);

  // Priorité : alias standard d'abord, cbMarq en fallback
  const cols = res.recordset.map(r => r.COLUMN_NAME);
  const col  = cols.find(c => c.toLowerCase() === 'watermark_sync') || cols.find(c => c === 'cbMarq') || null;

  _wmColCache[viewName] = col;
  if (col) logger.debug(`[engine] ${viewName} → colonne watermark : ${col}`);
  else     logger.warn(`[engine] ${viewName} → aucune colonne watermark trouvée, mode FULL forcé`);

  return col;
}

/**
 * Récupère la config distante depuis la plateforme (au démarrage).
 */
async function fetchRemoteConfig() {
  try {
    const axios  = require('axios');
    const { getToken, getPlatformUrl } = require('../security/token');
    const token   = getToken();
    const baseUrl = getPlatformUrl();

    const res = await axios.get(`${baseUrl}/api/v1/agent/config`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000,
    });
    _remoteConfig = res.data;
    logger.info(`[engine] Config distante récupérée : ${_remoteConfig.views_enabled?.length} vues activées`);
  } catch (err) {
    logger.warn(`[engine] Impossible de récupérer la config distante : ${err.message} — utilisation config locale`);
  }
}

/**
 * Détermine si une vue doit être synchronisée maintenant.
 * Basé sur l'intervalle (minutes) défini dans VIEWS ou la config distante.
 */
const _lastRunTimes = {};

function shouldSync(viewName) {
  const remoteIntervals = _remoteConfig?.sync_intervals || [];
  const remote = remoteIntervals.find(c => c.view === viewName);
  const intervalMin = remote?.interval ?? VIEWS[viewName]?.interval ?? 60;

  const lastRun = _lastRunTimes[viewName];
  if (!lastRun) return true;

  const elapsed = (Date.now() - lastRun) / 60000; // en minutes
  return elapsed >= intervalMin;
}

/**
 * Exécute un cycle de synchronisation complet.
 * Appelé par le scheduler toutes les minutes.
 */
async function run() {
  const pool    = await getPool();
  const agentId = config.get('agent_id') || 'unknown';

  logger.info('[engine] Cycle de synchronisation démarré');

  // Traiter les commandes distantes reçues au dernier heartbeat
  await processCommands(pool);

  const viewNames = Object.keys(VIEWS);
  let syncedThisCycle = 0;

  for (const viewName of viewNames) {
    if (!shouldSync(viewName)) continue;

    try {
      const syncMode = VIEWS[viewName].mode;
      const lastWatermark = syncMode === 'INCREMENTAL' ? await watermark.get(pool, viewName) : 0;

      // Détecter le nom de la colonne watermark dans la vue (Watermark_Sync ou cbMarq)
      const wmCol = await resolveWatermarkColumn(pool, viewName);
      const effectiveMode = (syncMode === 'INCREMENTAL' && wmCol) ? 'INCREMENTAL' : 'FULL';

      const query = effectiveMode === 'INCREMENTAL'
        ? `SELECT TOP 5000 * FROM dbo.${viewName}
           WHERE ${wmCol} > @watermark
           ORDER BY ${wmCol} ASC`
        : `SELECT * FROM dbo.${viewName}`;

      const request = pool.request();
      if (effectiveMode === 'INCREMENTAL') {
        request.input('watermark', lastWatermark);
      }

      const result = await request.query(query);

      if (result.recordset.length === 0) {
        logger.debug(`[engine] ${viewName} — aucune nouveauté`);
        _lastRunTimes[viewName] = Date.now();
        continue;
      }

      // Transformer et uploader
      const { records } = transformer.transform(viewName, result.recordset);
      const newWatermark = syncMode === 'INCREMENTAL'
        ? Math.max(...result.recordset.map(r => r[wmCol] || r.Watermark_Sync || r.cbMarq || 0))
        : 0;

      await uploader.send({
        viewName,
        syncMode:      effectiveMode,
        watermarkMin:  lastWatermark,
        watermarkMax:  newWatermark,
        schemaVersion: config.get('sage_version') || 'unknown',
        records,
        agentId,
      });

      // Mettre à jour le watermark après upload réussi
      if (effectiveMode === 'INCREMENTAL' && newWatermark > 0) {
        await watermark.set(pool, viewName, newWatermark);
      }

      syncedThisCycle += result.recordset.length;
      _totalSynced    += result.recordset.length;
      _lastRunTimes[viewName] = Date.now();

      // Mise à jour statut par vue dans le dashboard
      health.setViewStatus(viewName, {
        lastSync:  new Date().toISOString(),
        lastCount: result.recordset.length,
        mode:      effectiveMode,
        interval:  VIEWS[viewName]?.interval,
      });

      logger.info(`[engine] ${viewName} — ${result.recordset.length} lignes (watermark: ${newWatermark})`);

    } catch (err) {
      logger.error(`[engine] Erreur sync ${viewName} : ${err.message}`);
      // On continue avec la vue suivante — pas de crash global
    }
  }

  _lastSync = new Date();
  health.setStatus({ ok: true, lastSync: _lastSync, error: null });

  if (syncedThisCycle > 0) {
    logger.info(`[engine] Cycle terminé — ${syncedThisCycle} lignes envoyées`);
  } else {
    logger.debug('[engine] Cycle terminé — aucune nouveauté');
  }
}

/**
 * Traite les commandes reçues depuis le dernier heartbeat.
 */
async function processCommands(pool) {
  const pending = require('../scheduler').getPendingCommands();
  for (const cmd of pending) {
    logger.info(`[engine] Commande reçue : ${cmd}`);
    if (cmd === 'FORCE_FULL_SYNC') {
      // Réinitialiser tous les watermarks → prochaine sync sera complète
      const { reset } = require('./watermark');
      for (const viewName of Object.keys(VIEWS)) {
        await reset(pool, viewName);
      }
      logger.info('[engine] Tous les watermarks réinitialisés — prochaine sync sera FULL');
    }
  }
}

function getStats() {
  return { lastSync: _lastSync, totalSynced: _totalSynced };
}

module.exports = { run, fetchRemoteConfig, getStats };
