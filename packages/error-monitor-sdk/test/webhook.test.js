'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withWebhookErrorMonitor } = require('../src/client');
const f = require('./fixtures');

const KEY = 'webhook-test-signing-key-0123456789';
const params = { ERROR_MONITOR_ENDPOINT: 'https://monitor.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY };
const source = { app: 'wh-test', action: 'validate' };
function mockFetch(id = '20261109120000000-abcdef12') {
  const calls = [];
  const fn = async (url, init) => { calls.push(init); return { ok: true, status: 201, json: async () => ({ id }) }; };
  fn.calls = calls;
  return fn;
}

test('success path: the handler response is returned unchanged and nothing is recorded', async () => {
  const fetchImpl = mockFetch();
  const res = await withWebhookErrorMonitor(async () => ({ statusCode: 200, body: { op: 'replace', path: 'result/x', value: 1 } }), { source, fetchImpl })(params);
  assert.deepEqual(res, { statusCode: 200, body: { op: 'replace', path: 'result/x', value: 1 } });
  assert.equal(fetchImpl.calls.length, 0);
});

test("default onError='exception': records the error and returns a valid webhook exception with a reference, never the error text", async () => {
  const fetchImpl = mockFetch();
  const res = await withWebhookErrorMonitor(async () => { throw new Error(`db down: password=${f.password}`); }, { source, fetchImpl, customerMessage: 'Your cart could not be checked.' })(params);
  assert.equal(res.statusCode, 200, 'Commerce webhooks need HTTP 200 + an operation');
  assert.equal(res.body.op, 'exception');
  assert.equal(res.body.message, 'Your cart could not be checked. (reference 20261109120000000-abcdef12)');
  assert.ok(!JSON.stringify(res).includes('db down') && !JSON.stringify(res).includes(f.password));
  assert.equal(fetchImpl.calls.length, 1);
  const sent = JSON.parse(fetchImpl.calls[0].body);
  assert.deepEqual(sent.context.tags, { kind: 'webhook', failOpen: false });
  assert.ok(!fetchImpl.calls[0].body.includes(f.password), 'sanitized before sending');
});

test("onError='success' fails open: Commerce continues, error still recorded", async () => {
  const fetchImpl = mockFetch();
  const res = await withWebhookErrorMonitor(async () => { throw new Error('rate service timeout'); }, { source, fetchImpl, onError: 'success' })(params);
  assert.deepEqual(res, { statusCode: 200, body: { op: 'success' } });
  assert.equal(JSON.parse(fetchImpl.calls[0].body).context.tags.failOpen, true);
});

test('monitor slow or down: the webhook still answers quickly with a valid operation (no reference)', async () => {
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const started = Date.now();
  const res = await withWebhookErrorMonitor(async () => { throw new Error('x-slow-monitor'); }, { source, fetchImpl: hang, timeoutMs: 30 })(params);
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(res, { statusCode: 200, body: { op: 'exception', message: 'The request could not be processed. Please try again.' } });
});

test('bad options are rejected when the action is wrapped (at deploy/test time, not during checkout)', () => {
  assert.throws(() => withWebhookErrorMonitor(async () => {}, { source, onError: 'ignore' }), /onError/);
  assert.throws(() => withWebhookErrorMonitor(async () => {}, { source, customerMessage: 'x'.repeat(201) }), /customerMessage/);
});

test('a failing resolveOptions still yields a valid webhook operation', async () => {
  const resolveOptions = () => { throw new Error('missing setting'); };
  const res = await withWebhookErrorMonitor(async () => { throw new Error('x'); }, { source, resolveOptions })(params);
  assert.deepEqual(res, { statusCode: 200, body: { op: 'exception', message: 'The request could not be processed. Please try again.' } });
});
