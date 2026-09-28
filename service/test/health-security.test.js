'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
process.env.COCKPIT_LOG_DIR = path.join(os.tmpdir(), 'cockpit-agent-phase0-tests');
const health = require('../src/utils/health');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('API locale : health disponible, SQL refusé sans secret ou avec secret invalide', async () => {
  const port = await freePort();
  const previous = process.env.COCKPIT_LOCAL_SQL_TOKEN;
  process.env.COCKPIT_LOCAL_SQL_TOKEN = 'a'.repeat(32);
  health.start(port);
  try {
    const url = `http://127.0.0.1:${port}`;
    const healthResponse = await fetch(url + '/health');
    assert.ok([200, 503].includes(healthResponse.status));
    const denied = await fetch(url + '/execute_sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql_query: 'SELECT 1' }) });
    assert.equal(denied.status, 403);
    const wrong = await fetch(url + '/execute_sql', { method: 'POST', headers: { Authorization: 'Bearer wrong' } });
    assert.equal(wrong.status, 403);
    delete process.env.COCKPIT_LOCAL_SQL_TOKEN;
    const disabled = await fetch(url + '/execute_sql', { method: 'POST' });
    assert.equal(disabled.status, 403);
    process.env.COCKPIT_LOCAL_SQL_TOKEN = 'a'.repeat(32);
    for (let i = 0; i < 7; i++) await fetch(url + '/execute_sql', { method: 'POST' });
    const limited = await fetch(url + '/execute_sql', { method: 'POST' });
    assert.equal(limited.status, 429);
  } finally {
    health.stop();
    if (previous === undefined) delete process.env.COCKPIT_LOCAL_SQL_TOKEN;
    else process.env.COCKPIT_LOCAL_SQL_TOKEN = previous;
  }
});
