'use strict';

/**
 * Upload d'un batch de données vers l'API Cockpit SaaS.
 * POST /api/v1/agent/ingest — authentification Bearer token agent.
 */

const axios  = require('axios');
const { getToken, getPlatformUrl } = require('../security/token');
const { AGENT_VERSION, BATCH_SIZE, UPLOAD_TIMEOUT_MS } = require('../../../shared/constants');
const logger = require('../utils/logger');

/**
 * Envoie un batch de données pour une vue.
 *
 * @param {Object} params
 * @param {string}   params.viewName
 * @param {string}   params.syncMode      - "INCREMENTAL" | "FULL"
 * @param {number}   params.watermarkMin
 * @param {number}   params.watermarkMax
 * @param {string}   params.schemaVersion
 * @param {any[]}    params.records
 * @param {string}   params.agentId
 * @returns {Promise<{ accepted: boolean, processed: number, watermark_ack: number }>}
 */
async function send(params) {
  const { viewName, syncMode, watermarkMin, watermarkMax, schemaVersion, records, agentId } = params;
  const token   = getToken();
  const baseUrl = getPlatformUrl();

  // Découper en sous-batches si nécessaire
  const chunks = [];
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    chunks.push(records.slice(i, i + BATCH_SIZE));
  }

  let lastAck = watermarkMax;

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const isLast = c === chunks.length - 1;

    const payload = {
      view_name:      viewName,
      sync_mode:      syncMode,
      watermark_min:  watermarkMin,
      watermark_max:  isLast ? watermarkMax : null,
      row_count:      chunk.length,
      schema_version: schemaVersion,
      rows:           chunk,
    };

    logger.debug(`[uploader] ${viewName} chunk ${c + 1}/${chunks.length} — ${chunk.length} lignes`);

    const response = await axios.post(
      `${baseUrl}/api/v1/agent/ingest`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
          'X-Agent-Id':    agentId,
          'X-Agent-Version': AGENT_VERSION,
        },
        timeout: UPLOAD_TIMEOUT_MS,
        maxContentLength: 50 * 1024 * 1024, // 50 MB max
      }
    );

    if (response.data?.watermark_ack) {
      lastAck = response.data.watermark_ack;
    }
  }

  logger.info(`[uploader] ${viewName} — ${records.length} lignes envoyées`);
  return { accepted: true, processed: records.length, watermark_ack: lastAck };
}

/**
 * Envoie un heartbeat à la plateforme.
 * POST /api/v1/agent/heartbeat
 */
async function sendHeartbeat(status, lastSync, nbRecordsTotal) {
  try {
    const token   = getToken();
    const baseUrl = getPlatformUrl();

    const response = await axios.post(
      `${baseUrl}/api/v1/agent/heartbeat`,
      { status, lastSync: lastSync?.toISOString() || null, nbRecordsTotal },
      {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000,
      }
    );

    return response.data; // { ok, serverTime, nextHeartbeat, commands[] }
  } catch (err) {
    logger.warn(`[uploader] Heartbeat échoué : ${err.message}`);
    return null;
  }
}

module.exports = { send, sendHeartbeat };
