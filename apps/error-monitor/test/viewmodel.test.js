'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('../src/commerce-backend-ui-1/web-src/src/lib/viewModel');
const f = require('../../../packages/error-monitor-sdk/test/fixtures');

const good = (over = {}) => ({ id: '20261109120000000-aaaaaaaa', timestamp: '2026-11-09T12:00:00.000Z', severity: 'error', fingerprint: 'f'.repeat(32), source: { app: 'demo', action: 'x' }, error: { name: 'TypeError', message: 'boom' }, ...over });

test('AC5: list - ok, empty, invalid, error states', () => {
  const ok = vm.parseListResponse(200, { instance: 'stage-1', records: [good()], truncated: false });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.rows[0].when, '2026-11-09 12:00:00 UTC');
  assert.equal(ok.instance, 'stage-1');

  assert.equal(vm.parseListResponse(200, { records: [] }).state, 'empty');
  for (const bad of [null, undefined, 'str', 42, [], {}, { records: 'x' }, { records: null }]) assert.equal(vm.parseListResponse(200, bad).state, 'invalid', JSON.stringify(bad));
  for (const st of [401, 403, 404, 500, 503]) {
    const r = vm.parseListResponse(st, { error: 'x' });
    assert.equal(r.state, 'error');
    assert.ok(r.message.length > 10);
  }
});

test('AC5: list - malformed rows are skipped and counted; all-malformed is "invalid", not blank', () => {
  const mixed = vm.parseListResponse(200, { records: [good(), null, { id: 1 }, good({ severity: 'fatal' }), good({ timestamp: 'nope' }), good({ id: '../x' }), 'str'] });
  assert.equal(mixed.state, 'ok');
  assert.equal(mixed.rows.length, 1);
  assert.equal(mixed.skipped, 6);
  assert.equal(vm.parseListResponse(200, { records: [null, 1] }).state, 'invalid');
});

test('AC5: detail - ok, invalid, 404', () => {
  const ok = vm.parseDetailResponse(200, { source: 'archive', record: good({ commerceInstanceId: 'stage-1', redactions: 3, error: { name: 'E', message: 'm', stack: 'E\n at x' }, context: { tags: { a: 'b' }, http: { method: 'GET', path: '/x', status: 500 } } }) });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.storedIn, 'Archive (Files)');
  assert.equal(ok.detail.http, 'GET /x 500');
  assert.deepEqual(ok.detail.tags, [['a', 'b']]);
  assert.equal(vm.parseDetailResponse(200, {}).state, 'invalid');
  assert.equal(vm.parseDetailResponse(200, { record: 'x' }).state, 'invalid');
  assert.match(vm.parseDetailResponse(404, {}).message, /not found/i);
});

test('AC6: display layer masks sensitive values even if the API returned them', () => {
  const rec = good({ error: { name: 'E', message: f.dirtyMessage, stack: `E\n at h (${f.stripe}) ${f.email}` }, source: { app: 'demo', action: 'x', version: f.aws }, context: { requestId: `req-${f.email}`, tags: { note: `password=${f.password}` } }, commerceInstanceId: 'stage-1', redactions: 0 });
  const out = JSON.stringify([vm.parseListResponse(200, { records: [rec] }), vm.parseDetailResponse(200, { record: rec })]);
  for (const s of f.SENSITIVE_VALUES) assert.ok(!out.includes(s), `leaked ${s.slice(0, 6)}…`);
});

test('markup in records is carried as inert text (React renders text nodes; no HTML sink exists)', () => {
  const r = vm.parseListResponse(200, { records: [good({ error: { name: 'E', message: '<img src=x onerror=alert(1)>' } })] });
  assert.equal(r.rows[0].message, '<img src=x onerror=alert(1)>');
  const src = require('node:fs').readFileSync(require.resolve('../src/commerce-backend-ui-1/web-src/src/components/ErrorMonitorPage.js'), 'utf8');
  assert.ok(!/dangerouslySetInnerHTML|innerHTML|eval\(/.test(src));
});

test('query builder only emits allow-listed params', () => {
  assert.equal(vm.buildQuery({ source: 'state', severity: 'error', app: 'demo', limit: '500' }), 'source=state&limit=100&severity=error&app=demo');
  assert.equal(vm.buildQuery({ source: 'archive', date: '2026-11-09', severity: '<x>', app: '../../' }), 'source=archive&limit=25&date=2026-11-09');
});
