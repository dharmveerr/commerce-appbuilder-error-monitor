'use strict';
const { handleList } = require('../lib/query');
const { createRealDeps } = require('../lib/defaults');

async function main(params) {
  try { return await handleList(params, { createDeps: createRealDeps }); } catch (e) {
    console.error(JSON.stringify({ level: 'error', event: 'list_errors_unhandled', name: e && e.name }));
    return { statusCode: 500, body: { error: 'internal_error' } };
  }
}
exports.main = main;
