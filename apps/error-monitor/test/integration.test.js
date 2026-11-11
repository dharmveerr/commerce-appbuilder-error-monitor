'use strict';
// Reuse demonstration, end to end and in-process:
//   sample-consumer action --(SDK, signed HTTP)--> record-error --> State/Files/Events --> list/get --> dashboard view-model
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleRecord } = require('../src/commerce-backend-ui-1/actions/lib/ingest');
const { handleList, handleGet } = require('../src/commerce-backend-ui-1/actions/lib/query');
const vm = require('../src/commerce-backend-ui-1/web-src/src/lib/viewModel');
const { withErrorMonitor } = require('@commerce-ext/error-monitor-sdk');
const { syncOrders } = require('../../sample-consumer/actions/orders-sync');
const { makeEnv, adminRequest, baseParams, KEY } = require('./helpers/fakes');
const f = require('../../../packages/error-monitor-sdk/test/fixtures');

test('sample consumer -> monitor -> dashboard: one tested error, all acceptance checks, no sensitive values anywhere', async () => {
  const env = makeEnv();
  // Loopback transport: what the network would deliver to the record-error web action.
  const loopback = async (url, init) => {
    const headers = Object.fromEntries(Object.entries(init.headers));
    const res = await handleRecord({ ...baseParams(), __ow_method: 'post', __ow_headers: headers, __ow_body: init.body }, { deps: env.deps });
    return { ok: res.statusCode < 300, status: res.statusCode, json: async () => res.body };
  };
  const consumer = withErrorMonitor(syncOrders, { source: { app: 'sample-consumer', action: 'orders-sync', version: '0.1.0', environment: 'stage' }, fetchImpl: loopback });

  const result = await consumer({ simulate: 'leak', customerEmail: f.email, UPSTREAM_TOKEN: f.bearer, ERROR_MONITOR_ENDPOINT: 'https://monitor.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY });
  assert.equal(result.error.statusCode, 500);
  const errorId = result.error.body.errorId;
  assert.match(errorId, /^\d{17}-[0-9a-f]{8}$/);

  // Events: exactly one notification for the tested error
  assert.equal(env.published.length, 1);
  assert.equal(env.published[0].data.errorId, errorId);

  // State + Files both hold it
  const list = await handleList(adminRequest({}), { deps: env.deps });
  const detail = await handleGet(adminRequest({ id: errorId }), { deps: env.deps });
  const arch = await handleList(adminRequest({ source: 'archive', date: new Date().toISOString().slice(0, 10) }), { deps: env.deps });
  assert.equal(list.body.count, 1);
  assert.equal(arch.body.count, 1);

  // Dashboard view-model renders it
  const rows = vm.parseListResponse(list.statusCode, list.body);
  const det = vm.parseDetailResponse(detail.statusCode, detail.body);
  assert.equal(rows.state, 'ok');
  assert.equal(rows.rows[0].app, 'sample-consumer');
  assert.equal(det.state, 'ok');
  assert.ok(det.detail.redactions >= 2);

  // Sensitive values: nowhere in storage, events, API output, or view-model output
  const all = JSON.stringify([...env.state.m.values(), [...env.files.m.values()].map(String), env.published, list, detail, arch, rows, det, result]);
  for (const s of f.SENSITIVE_VALUES) assert.ok(!all.includes(s), `leaked ${s.slice(0, 6)}…`);
});
