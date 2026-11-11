'use strict';
const { handleRecord } = require('../lib/ingest');
const { createRealDeps } = require('../lib/defaults');

async function main(params) {
  try { return await handleRecord(params, { createDeps: createRealDeps }); } catch (e) {
    console.error(JSON.stringify({ level: 'error', event: 'record_error_unhandled', name: e && e.name }));
    return { statusCode: 500, body: { error: 'internal_error' } };
  }
}
exports.main = main;
