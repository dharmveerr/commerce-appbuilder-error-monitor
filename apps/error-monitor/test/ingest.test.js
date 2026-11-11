'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleRecord } = require('../src/commerce-backend-ui-1/actions/lib/ingest');
const { validateRecord } = require('@commerce-ext/error-monitor-sdk');
const { signedRequest, makeEnv, baseParams } = require('./helpers/fakes');
const f = require('../../../packages/error-monitor-sdk/test/fixtures');

const payload = (over = {}) => ({ source: { app: 'demo', action: 'act' }, severity: 'error', error: { name: 'TypeError', message: 'boom 7', stack: 'TypeError: boom\n    at x (/srv/x.js:1:1)' }, ...over });
const body = (res) => (typeof res.body === 'string' ? JSON.parse(res.body) : res.body);

test('AC1+AC2+AC3+AC4: valid error -> schema-valid record in State, copy in Files, Events notification emitted', async () => {
  const env = makeEnv();
  const res = await handleRecord(signedRequest(payload()), { deps: env.deps });
  assert.equal(res.statusCode, 201);
  const out = body(res);
  assert.deepEqual(out.stored, { state: true, archive: true });
  assert.deepEqual(out.event, { emitted: true });

  // State holds a schema-valid record, with the configured TTL
  const [[key, entry]] = [...env.state.m.entries()];
  assert.match(key, /^e\.stage-1\.\d{8}\.\d{17}-[0-9a-f]{8}$/);
  assert.equal(entry.ttl, 604800);
  const rec = JSON.parse(entry.value);
  assert.deepEqual(validateRecord(rec), []);
  assert.equal(rec.commerceInstanceId, 'stage-1');

  // Files holds the same record at the documented path
  const [[path, buf]] = [...env.files.m.entries()];
  assert.match(path, /^error-monitor\/stage-1\/\d{4}\/\d{2}\/\d{2}\/\d{17}-[0-9a-f]{8}\.json$/);
  assert.deepEqual(JSON.parse(buf.toString()), rec);

  // Events: configured type + provider source, summary only (no stack)
  assert.equal(env.published.length, 1);
  const ev = env.published[0];
  assert.equal(ev.type, 'com.example.commerce.error_monitor.error_recorded');
  assert.equal(ev.source, 'urn:uuid:00000000-0000-4000-8000-000000000000');
  assert.equal(ev.id, rec.id);
  assert.equal(ev.data.severity, 'error');
  assert.ok(!('stack' in ev.data));
});

test('caller cannot choose the Commerce instance or record id', async () => {
  const env = makeEnv();
  const evil = payload();
  evil.commerceInstanceId = 'other-instance';
  evil.id = '00000000000000000-deadbeef';
  const res = await handleRecord(signedRequest(evil), { deps: env.deps });
  assert.equal(res.statusCode, 201);
  const rec = JSON.parse([...env.state.m.values()][0].value);
  assert.equal(rec.commerceInstanceId, 'stage-1');
  assert.notEqual(rec.id, evil.id);
});

test('AC6: sensitive test values never reach State, Files or Events (even if the client did not sanitize)', async () => {
  const env = makeEnv();
  const res = await handleRecord(signedRequest(payload({
    error: { name: 'E', message: f.dirtyMessage, stack: `E\n    at h (${f.stripe})` },
    context: { requestId: 'r1', http: { method: 'POST', path: `/hook?token=${f.bearer}` }, tags: { apiKey: f.stripe, note: `password: ${f.password}` } }
  })), { deps: env.deps });
  assert.equal(res.statusCode, 201);
  const everything = JSON.stringify([...env.state.m.values()]) + JSON.stringify([...env.files.m.values()].map((b) => b.toString())) + JSON.stringify(env.published) + JSON.stringify(res);
  for (const v of f.SENSITIVE_VALUES) assert.ok(!everything.includes(v), `leaked ${v.slice(0, 6)}…`);
  assert.ok(JSON.parse([...env.state.m.values()][0].value).redactions > 5);
});

test('authentication: unsigned, tampered, wrong key, stale -> 401 and nothing is written', async () => {
  const env = makeEnv();
  const cases = [
    { ...signedRequest(payload()), __ow_headers: { 'content-type': 'application/json' } },
    signedRequest(payload(), { tamper: true }),
    signedRequest(payload(), { key: 'x'.repeat(40) }),
    signedRequest(payload(), { nowMs: Date.now() - 3_600_000 })
  ];
  for (const c of cases) {
    const res = await handleRecord(c, { deps: env.deps });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(body(res), { error: 'unauthorized' }); // no reason leaked to caller
  }
  assert.equal(env.state.m.size, 0);
  assert.equal(env.files.m.size, 0);
  assert.equal(env.published.length, 0);
});

test('validation: bad JSON, bad shape, oversize, wrong method', async () => {
  const env = makeEnv();
  assert.equal((await handleRecord(signedRequest('{not json'), { deps: env.deps })).statusCode, 400);
  const bad = await handleRecord(signedRequest({ source: {}, error: {} }), { deps: env.deps });
  assert.equal(bad.statusCode, 400);
  assert.ok(body(bad).details.length >= 2);
  assert.equal((await handleRecord(signedRequest(payload({ error: { message: 'x'.repeat(70000) } })), { deps: env.deps })).statusCode, 413);
  assert.equal((await handleRecord({ ...signedRequest(payload()), __ow_method: 'get' }, { deps: env.deps })).statusCode, 405);
  assert.equal(env.state.m.size, 0);
});

test('configuration errors fail closed with a generic message (no setting names or values returned)', async () => {
  const res = await handleRecord(signedRequest(payload(), { params: baseParams({ INGEST_SIGNING_KEY: 'short' }) }), { deps: makeEnv().deps });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(body(res), { error: 'service_misconfigured' });
});

test('events: below-threshold severity is stored but not published', async () => {
  const env = makeEnv();
  const res = await handleRecord(signedRequest(payload({ severity: 'warning' })), { deps: env.deps });
  assert.deepEqual(body(res).event, { emitted: false, reason: 'below_threshold' });
  assert.equal(env.published.length, 0);
  assert.equal(env.state.m.size, 1);
});

test('resilience: Events failure and Files failure do not lose the State record', async () => {
  const env = makeEnv();
  env.deps.publisher = { publish: async () => { throw new Error('events down'); } };
  env.deps.archive = { write: async () => { throw new Error('files down'); } };
  const res = await handleRecord(signedRequest(payload()), { deps: env.deps });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(body(res).stored, { state: true, archive: false });
  assert.deepEqual(body(res).event, { emitted: false, reason: 'publish_failed' });
  assert.equal(env.state.m.size, 1);
});

test('resilience: State failure returns 503 (caller can see the record was not stored)', async () => {
  const env = makeEnv();
  env.deps.state = { put: async () => { throw new Error('state down'); } };
  assert.equal((await handleRecord(signedRequest(payload()), { deps: env.deps })).statusCode, 503);
  assert.equal(env.published.length, 0, 'no notification for a record that was not stored');
});

test('events disabled when no provider configured', async () => {
  const env = makeEnv();
  env.deps.publisher = null;
  const res = await handleRecord(signedRequest(payload(), { params: baseParams({ EVENT_PROVIDER_ID: undefined, EVENTS_ENABLED: 'false' }) }), { deps: env.deps });
  assert.deepEqual(body(res).event, { emitted: false, reason: 'disabled' });
});
