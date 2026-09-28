'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePilotPayload, executePilot } = require('../src/jobs/query-executor-v2');

const statement = 'SELECT TOP (1000) CONVERT(varchar(64), SUM([ca_ht])) AS [value], COUNT_BIG(*) AS [__source_row_count] FROM [dbo].[VW_FINANCE_GENERAL] WHERE [dt_jour] >= @periodFrom AND [dt_jour] < @periodTo';
const payload = () => ({ protocolVersion: 2, jobId: 'j1', queryId: 'q1', sequence: 1,
  resourceId: 'sage100:finance_general', statement,
  parameters: { periodFrom: '2026-09-01', periodTo: '2026-10-01' },
  limits: { timeoutMs: 30000, maxRows: 1000, maxResultBytes: 1048576 } });

test('borne le statement à la vue CA HT et aux dates', () => {
  assert.equal(validatePilotPayload(payload()).periodFrom, '2026-09-01');
  assert.throws(() => validatePilotPayload({ ...payload(), statement: statement + '; DELETE FROM users' }), /INVALID_V2_STATEMENT/);
  assert.throws(() => validatePilotPayload({ ...payload(), parameters: { ...payload().parameters, source0: '70%' } }), /INVALID_V2_PARAMETERS/);
  assert.throws(() => validatePilotPayload({ ...payload(), resourceId: 'other' }), /INVALID_V2_PLAN/);
});

test('lie les dates et renvoie le décimal sans conversion flottante', async () => {
  const inputs = [];
  const request = { input: (...args) => { inputs.push(args); return request; },
    query: async sql => { assert.equal(sql, statement); return { recordset: [
      { value: '12450000.000000', __source_row_count: 2 },
    ] }; } };
  const rows = await executePilot(payload(), { pool: { request: () => request },
    sql: { VarChar: n => 'varchar' + n, Date: 'date' } });
  assert.deepEqual(rows, [{ value: '12450000.00', __source_row_count: 2 }]);
  assert.deepEqual(inputs.map(x => x[0]), ['periodFrom', 'periodTo']);
  assert.equal(inputs[0][2].toISOString(), '2026-09-01T00:00:00.000Z');
});

test('refuse une réponse trop grande et un type monétaire imprécis', async () => {
  const make = recordset => {
    const req = { input: () => req, query: async () => ({ recordset }) };
    return { pool: { request: () => req }, sql: { VarChar: () => 'varchar', Date: 'date' } };
  };
  await assert.rejects(executePilot(payload(), make([{ value: 0, __source_row_count: 1 }])), /SOURCE_SCHEMA_MISMATCH/);
  await assert.rejects(executePilot(payload(), make([{ value: '0.001000', __source_row_count: 1 }])), /SOURCE_SCHEMA_MISMATCH/);
  await assert.rejects(executePilot({ ...payload(), limits: { ...payload().limits, maxResultBytes: 10 } },
    make([{ value: '0.00', __source_row_count: 1 }])), /RESULT_TOO_LARGE/);
});

test('autorise le groupement mensuel strict et refuse une dimension libre', () => {
  const grouped = statement.replace(' FROM [dbo]', ', [annee_mois] AS [month] FROM [dbo]') +
    ' GROUP BY [annee_mois] ORDER BY [annee_mois] ASC';
  assert.equal(validatePilotPayload({ ...payload(), statement: grouped }).periodFrom, '2026-09-01');
  assert.throws(() => validatePilotPayload({ ...payload(),
    statement: grouped.replace('[annee_mois] AS [month]', '[cg_num] AS [account]') }),
    /INVALID_V2_STATEMENT/);
});
