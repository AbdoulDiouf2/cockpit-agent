'use strict';

const config = require('../config');
const { executePilot } = require('../jobs/query-executor-v2');

function attach(socket, deps = {}) {
  let accepted = false;
  socket.on('authenticated', () => {
    if ((deps.pilotEnabled ?? config.load().enable_v2_revenue_pilot) !== true) return;
    socket.emit('agent_hello_v2', {
      protocolVersions: [1, 2], agentVersion: require('../../../shared/constants').AGENT_VERSION,
      capabilities: ['query_parameters', 'typed_schema'],
    }, response => { accepted = response?.status === 'accepted'; });
  });
  socket.on('disconnect', () => { accepted = false; });
  socket.on('execute_query_v2', async payload => {
    if (!accepted) return;
    const envelope = { protocolVersion: 2, jobId: payload?.jobId,
      queryId: payload?.queryId, sequence: payload?.sequence };
    socket.emit('query_acknowledged_v2', { ...envelope, acceptedAt: new Date().toISOString() });
    try {
      const rows = await (deps.executePilot || executePilot)(payload);
      socket.emit('query_result_v2', { ...envelope, status: 'success', rows });
    } catch (error) {
      const code = error?.code === 'ETIMEOUT' ? 'QUERY_TIMEOUT' : ['INVALID_V2_PLAN', 'INVALID_V2_STATEMENT', 'INVALID_V2_PARAMETERS',
        'INVALID_V2_LIMITS', 'RESULT_TOO_LARGE', 'SOURCE_SCHEMA_MISMATCH'].includes(error?.message)
        ? error.message : 'SOURCE_UNAVAILABLE';
      socket.emit('query_result_v2', { ...envelope, status: 'error', error: { code } });
    }
  });
}

module.exports = { attach };
