'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createErrorMonitor, withErrorMonitor } = require('../src/client');
const { verifySignature, signedHeaders } = require('../src/signing');
const f = require('./fixtures');

const KEY = 'unit-test-signing-key';
const source = { app: 'sdk-test', action: 'a' };
function mockFetch(status = 201, body = { id: '20261109120000000-aaaaaaaa' }) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return { ok: status < 300, status, json: async () => body }; };
  fn.calls = calls;
  return fn;
}

test('signs and posts a sanitized payload', async () => {
  const fetchImpl = mockFetch();
  const m = createErrorMonitor({ endpoint: 'https://example.invalid/record', signingKey: KEY, source, fetchImpl });
  const r = await m.record(new Error(f.dirtyMessage), { context: { requestId: 'req-1' } });
  assert.deepEqual(r, { recorded: true, id: '20261109120000000-aaaaaaaa' });
  const { init } = fetchImpl.calls[0];
  assert.equal(verifySignature(KEY, init.headers, init.body).ok, true);
  for (const v of f.SENSITIVE_VALUES) assert.ok(!init.body.includes(v), 'client must sanitize before sending');
});

test('never throws: network failure, HTTP error, timeout, bad config', async () => {
  const boom = async () => { throw new Error('ECONNRESET'); };
  assert.equal((await createErrorMonitor({ endpoint: 'https://x.invalid/r', signingKey: KEY, source, fetchImpl: boom }).record(new Error('a'))).reason, 'transport_error');
  assert.equal((await createErrorMonitor({ endpoint: 'https://x.invalid/r', signingKey: KEY, source, fetchImpl: mockFetch(503) }).record(new Error('b'))).reason, 'http_503');
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  assert.equal((await createErrorMonitor({ endpoint: 'https://x.invalid/r', signingKey: KEY, source, fetchImpl: hang, timeoutMs: 20 }).record(new Error('c'))).reason, 'transport_error');
  assert.equal((await createErrorMonitor({ source }).record(new Error('d'))).reason, 'not_configured');
  assert.equal((await createErrorMonitor({ endpoint: 'http://insecure.example/r', signingKey: KEY, source, fetchImpl: mockFetch() }).record(new Error('e'))).reason, 'not_configured');
});

test('client-side throttle caps an error storm per fingerprint', async () => {
  const fetchImpl = mockFetch();
  const m = createErrorMonitor({ endpoint: 'https://x.invalid/r', signingKey: KEY, source, fetchImpl, throttle: { maxPerWindow: 3, windowMs: 60000 } });
  const results = [];
  for (let i = 0; i < 6; i++) results.push((await m.record(new Error('storm-unique-xyz'))).reason || 'sent');
  assert.equal(fetchImpl.calls.length, 3);
  assert.deepEqual(results.slice(3), ['throttled', 'throttled', 'throttled']);
});

test('withErrorMonitor: records, returns generic 500 + errorId, passes through success', async () => {
  const fetchImpl = mockFetch();
  const params = { ERROR_MONITOR_ENDPOINT: 'https://x.invalid/r', ERROR_MONITOR_SIGNING_KEY: KEY };
  const ok = await withErrorMonitor(async () => ({ statusCode: 200, body: 'fine' }), { source, fetchImpl })(params);
  assert.equal(ok.statusCode, 200);
  assert.equal(fetchImpl.calls.length, 0);
  const bad = await withErrorMonitor(async () => { throw new Error(`leak ${f.password}`); }, { source, fetchImpl })(params);
  assert.equal(bad.error.statusCode, 500);
  assert.equal(bad.error.body.error, 'Internal Server Error');
  assert.ok(bad.error.body.errorId);
  assert.ok(!JSON.stringify(bad).includes(f.password));
  assert.equal(fetchImpl.calls.length, 1);
});

test('signature: tamper, wrong key and stale timestamp are rejected', () => {
  const body = '{"a":1}';
  const h = signedHeaders(KEY, body, 1_800_000_000_000);
  const opts = { nowMs: 1_800_000_000_000 };
  assert.equal(verifySignature(KEY, h, body, opts).ok, true);
  assert.equal(verifySignature(KEY, h, body + ' ', opts).ok, false);
  assert.equal(verifySignature('other', h, body, opts).ok, false);
  assert.equal(verifySignature(KEY, h, body, { nowMs: 1_800_000_000_000 + 301_000 }).reason, 'stale_timestamp');
  assert.equal(verifySignature(KEY, {}, body, opts).reason, 'missing_headers');
  assert.equal(verifySignature('', h, body, opts).ok, false);
});

test('client reports how many values it redacted so the server-side total is not under-counted', async () => {
  const fetchImpl = mockFetch();
  const m = createErrorMonitor({ endpoint: 'https://example.invalid/record', signingKey: KEY, source, fetchImpl });
  await m.record(new Error(`count-me ${f.email} ${f.aws}`));
  // `redactions` counts masked OCCURRENCES: 2 values x (error.message + the first line of error.stack) = 4
  assert.equal(JSON.parse(fetchImpl.calls[0].init.body).redactions, 4);
});
