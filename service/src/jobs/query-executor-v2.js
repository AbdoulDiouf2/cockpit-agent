'use strict';

// Exécuteur strictement borné au pilote comptable ; le backend fournit le plan.

const STATEMENT = /^SELECT TOP \(([1-9][0-9]{0,3})\) CONVERT\(varchar\(64\), SUM\(\[ca_ht\]\)\) AS \[value\], COUNT_BIG\(\*\) AS \[__source_row_count\](, \[annee_mois\] AS \[month\])? FROM \[dbo\]\.\[VW_FINANCE_GENERAL\] WHERE \[dt_jour\] >= @periodFrom AND \[dt_jour\] < @periodTo( GROUP BY \[annee_mois\])?( ORDER BY \[annee_mois\] (ASC|DESC))?$/;
const campaigns = require('./certification-campaigns-v2.json');

function validateCertificationStatement(payload) {
  const campaign = campaigns.find(candidate => candidate.id === payload.certificationCampaign?.id &&
    candidate.version === payload.certificationCampaign?.version &&
    candidate.registryVersion === payload.registryVersion &&
    candidate.resourceId === payload.resourceId);
  if (!campaign) throw new Error('INVALID_V2_PLAN');
  if (!campaign.plans.some(plan => plan.statement === payload.statement))
    throw new Error('INVALID_V2_STATEMENT');
  if (!campaign.periods.some(([from, to]) => from === payload.parameters?.periodFrom &&
      to === payload.parameters?.periodTo))
    throw new Error('INVALID_V2_PARAMETERS');
}

function validatePilotPayload(payload) {
  if (!payload || payload.protocolVersion !== 2 ||
      payload.resourceId !== 'sage100:finance_general' ||
      typeof payload.jobId !== 'string' || typeof payload.queryId !== 'string' ||
      !Number.isInteger(payload.sequence) || payload.sequence < 1)
    throw new Error('INVALID_V2_PLAN');
  if (payload.executionPurpose === 'certification') {
    validateCertificationStatement(payload);
  } else {
    if (payload.executionPurpose !== undefined || payload.certificationCampaign !== undefined ||
        payload.registryVersion !== undefined) throw new Error('INVALID_V2_PLAN');
    const match = STATEMENT.exec(payload.statement || '');
    if (!match || Number(match[1]) > 1000 || !!match[2] !== !!match[3])
      throw new Error('INVALID_V2_STATEMENT');
  }
  const params = payload.parameters;
  if (!params || Object.keys(params).sort().join(',') !== 'periodFrom,periodTo' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(params.periodFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(params.periodTo) ||
      params.periodFrom >= params.periodTo ||
      !Number.isFinite(Date.parse(params.periodFrom)) ||
      !Number.isFinite(Date.parse(params.periodTo)))
    throw new Error('INVALID_V2_PARAMETERS');
  if (!payload.limits || !Number.isInteger(payload.limits.timeoutMs) ||
      payload.limits.timeoutMs < 1 || payload.limits.timeoutMs > 30000 ||
      !Number.isInteger(payload.limits.maxRows) || payload.limits.maxRows < 1 ||
      payload.limits.maxRows > 1000 ||
      !Number.isInteger(payload.limits.maxResultBytes) ||
      payload.limits.maxResultBytes < 1 || payload.limits.maxResultBytes > 1048576)
    throw new Error('INVALID_V2_LIMITS');
  return params;
}

async function executePilot(payload, deps = {}) {
  const params = validatePilotPayload(payload);
  const connection = deps.sql && deps.pool ? null : require('../sql/connection');
  const driver = deps.sql || connection.sql;
  const pool = deps.pool || await connection.getPool();
  const request = pool.request();
  request.timeout = payload.limits.timeoutMs;
  request.input('periodFrom', driver.Date, new Date(params.periodFrom + 'T00:00:00Z'));
  request.input('periodTo', driver.Date, new Date(params.periodTo + 'T00:00:00Z'));
  const response = await request.query(payload.statement);
  const rows = response.recordset || [];
  if (rows.length > payload.limits.maxRows ||
      Buffer.byteLength(JSON.stringify(rows)) > payload.limits.maxResultBytes)
    throw new Error('RESULT_TOO_LARGE');
  return rows.map(row => {
    if (row.value !== null && (typeof row.value !== 'string' ||
        !/^-?\d+\.\d{2}0*$/.test(row.value)))
      throw new Error('SOURCE_SCHEMA_MISMATCH');
    const normalized = { value: row.value === null ? null : row.value.replace(/(\.\d{2})0+$/, '$1'),
      __source_row_count: row.__source_row_count };
    if (Object.prototype.hasOwnProperty.call(row, 'month')) normalized.month = row.month;
    return normalized;
  });
}

module.exports = { validatePilotPayload, executePilot };
