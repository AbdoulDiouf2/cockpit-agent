'use strict';

/**
 * Transformateur de données avant upload vers l'API SaaS.
 * Nettoie les valeurs null/undefined, normalise les dates,
 * et assure que les records sont sérialisables en JSON.
 */

/**
 * @param {string} viewName
 * @param {any[]}  records   - Lignes brutes retournées par mssql
 * @returns {{ records: Record<string,any>[], agentId: string }}
 */
function transform(viewName, records) {
  const config = require('../config');
  const agentId = config.get('agent_id') || 'unknown';

  const cleaned = records.map(row => {
    const out = {};
    for (const [key, val] of Object.entries(row)) {
      if (val === null || val === undefined) {
        out[key] = null;
      } else if (val instanceof Date) {
        out[key] = val.toISOString();
      } else if (typeof val === 'bigint') {
        out[key] = Number(val);
      } else if (Buffer.isBuffer(val)) {
        out[key] = val.toString('hex');
      } else {
        out[key] = val;
      }
    }
    return out;
  });

  return { records: cleaned, agentId };
}

module.exports = { transform };
