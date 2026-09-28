'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { attach } = require('../src/ws/query-protocol-v2');

function socketHarness(enabled, executePilot = async () => [{ value: '0.00', __source_row_count: 1 }]) {
  const handlers = new Map(); const outgoing = [];
  const socket = { on: (name, fn) => handlers.set(name, fn),
    emit: (name, payload, ack) => {
      outgoing.push({ name, payload });
      if (name === 'agent_hello_v2') ack?.({ status: 'accepted' });
    } };
  attach(socket, { executePilot, pilotEnabled: enabled });
  return { handlers, outgoing };
}
const payload = { protocolVersion: 2, jobId: 'j1', queryId: 'q1', sequence: 1 };
test('agent non opt-in ne négocie ni exécute V2', async () => {
  const h = socketHarness(false);
  h.handlers.get('authenticated')();
  await h.handlers.get('execute_query_v2')(payload);
  assert.deepEqual(h.outgoing, []);
});
test('agent opt-in annonce V2, acquitte et renvoie le résultat séparément de V1', async () => {
  const h = socketHarness(true);
  h.handlers.get('authenticated')();
  await h.handlers.get('execute_query_v2')(payload);
  assert.deepEqual(h.outgoing.map(x => x.name),
    ['agent_hello_v2', 'query_acknowledged_v2', 'query_result_v2']);
  assert.equal(h.outgoing[2].payload.rows[0].value, '0.00');
});
test('erreur source devient erreur explicite sans zéro', async () => {
  const h = socketHarness(true, async () => { throw new Error('SQL failed'); });
  h.handlers.get('authenticated')();
  await h.handlers.get('execute_query_v2')(payload);
  assert.equal(h.outgoing[2].payload.status, 'error');
  assert.equal(h.outgoing[2].payload.error.code, 'SOURCE_UNAVAILABLE');
});

test('timeout SQL devient QUERY_TIMEOUT', async () => {
  const h = socketHarness(true, async () => { const error = new Error('timeout'); error.code = 'ETIMEOUT'; throw error; });
  h.handlers.get('authenticated')();
  await h.handlers.get('execute_query_v2')(payload);
  assert.equal(h.outgoing[2].payload.error.code, 'QUERY_TIMEOUT');
});
