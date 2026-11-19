'use strict';
// Proves the sample app depends ONLY on the SDK: no Error Monitor app code is imported here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySignature } = require('@commerce-ext/error-monitor-sdk');
const f = require('../../../packages/error-monitor-sdk/test/fixtures');

const KEY = 'sample-consumer-test-key-0123456789abcdef';

test('orders-sync: success path does not contact the monitor', async () => {
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; return { ok: true, status: 201, json: async () => ({}) }; };
  try {
    const { main } = require('../actions/orders-sync');
    const res = await main({ simulate: 'ok', ERROR_MONITOR_ENDPOINT: 'https://m.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY });
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('orders-sync: failure is reported (signed, sanitized) and caller gets a generic 500', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return { ok: true, status: 201, json: async () => ({ id: '20261109120000000-0123abcd' }) }; };
  try {
    const { main } = require('../actions/orders-sync');
    const res = await main({ simulate: 'leak', customerEmail: f.email, UPSTREAM_TOKEN: f.bearer, ERROR_MONITOR_ENDPOINT: 'https://m.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY });
    assert.equal(res.error.statusCode, 500);
    assert.equal(res.error.body.errorId, '20261109120000000-0123abcd');
    assert.equal(sent.length, 1);
    assert.equal(verifySignature(KEY, sent[0].init.headers, sent[0].init.body).ok, true);
    for (const v of [f.bearer, f.email]) assert.ok(!sent[0].init.body.includes(v), 'secret/PII must not leave the consumer');
    assert.ok(!JSON.stringify(res).includes(f.bearer));
  } finally { globalThis.fetch = realFetch; }
});

test('orders-sync: if the monitor is unreachable the action still fails cleanly (monitoring never masks the error)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ENOTFOUND'); };
  try {
    const { main } = require('../actions/orders-sync');
    const res = await main({ simulate: 'fail', ERROR_MONITOR_ENDPOINT: 'https://m.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY });
    assert.equal(res.error.statusCode, 500);
    assert.equal(res.error.body.errorId, undefined);
  } finally { globalThis.fetch = realFetch; }
});

test('orders-sync: warning and critical demo modes record that severity and still return 200', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(init); return { ok: true, status: 201, json: async () => ({ id: '20261109120000000-0123abcf' }) }; };
  try {
    const { main } = require('../actions/orders-sync');
    for (const severity of ['warning', 'critical']) {
      const res = await main({ simulate: severity, ERROR_MONITOR_ENDPOINT: 'https://m.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.recordedSeverity, severity);
    }
    assert.deepEqual(sent.map((s) => JSON.parse(s.body).severity), ['warning', 'critical']);
  } finally { globalThis.fetch = realFetch; }
});

test('orders-sync: a returned 503 error response is recorded and returned unchanged', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(init); return { ok: true, status: 201, json: async () => ({ id: '20261109120000000-0123abce' }) }; };
  try {
    const { main } = require('../actions/orders-sync');
    const res = await main({ simulate: 'unavailable', ERROR_MONITOR_ENDPOINT: 'https://m.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY });
    assert.deepEqual(res, { error: { statusCode: 503, body: { error: 'Order service is unavailable' } } });
    assert.equal(sent.length, 1);
    assert.equal(JSON.parse(sent[0].body).error.code, '503');
  } finally { globalThis.fetch = realFetch; }
});

test('orders-sync is not exposed as a public web action', () => {
  const yaml = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/commerce-extensibility-1/ext.config.yaml'), 'utf8');
  const block = yaml.split('orders-sync:')[1].split('validate-cart:')[0];
  assert.match(block, /web: 'no'/);
});

test('validate-cart with the real Commerce webhook payload: normal SKU passes, configured SKU fails with a reference', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(init); return { ok: true, status: 201, json: async () => ({ id: '20261109120000000-00c0ffee' }) }; };
  try {
    const { main } = require('../actions/validate-cart');
    const base = { ERROR_MONITOR_ENDPOINT: 'https://m.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY, FAIL_ADD_TO_CART_SKUS: 'AGV-3939, OTHER', UPSTREAM_TOKEN: f.bearer };
    const add = (sku) => ({ ...base, data: { quote_item: { sku, qty: 1, quote_id: '42' } } });
    assert.deepEqual(await main(add('ACM-3030')), { statusCode: 200, body: { op: 'success' } });
    assert.equal(sent.length, 0);
    const res = await main(add('AGV-3939'));
    assert.equal(res.body.op, 'exception');
    assert.match(res.body.message, /\(reference 20261109120000000-00c0ffee\)$/);
    assert.ok(!sent[0].body.includes(f.bearer), 'token masked before sending');
  } finally { globalThis.fetch = realFetch; }
});

test('order-placed event: normal order synced; configured SKU makes the ERP call fail and is reported', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(init); return { ok: true, status: 201, json: async () => ({ id: '20261109120000000-0e7e0e7e' }) }; };
  try {
    const { main } = require('../actions/order-placed');
    const base = { ERROR_MONITOR_ENDPOINT: 'https://m.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY, FAIL_ORDER_SYNC_SKUS: 'BPG-5005', UPSTREAM_TOKEN: f.bearer };
    const event = (skus) => ({ ...base, data: { value: { increment_id: '000000101', items: skus.map((sku) => ({ sku })) } } });
    assert.deepEqual(await main(event(['ACM-3030'])), { statusCode: 200, body: { synced: '000000101', items: 1 } });
    const nested = await main({ ...base, data: { value: { order: { increment_id: '000000102', items: [{ sku: 'ACM-3030' }] } } } });
    assert.equal(nested.body.synced, '000000102');
    assert.equal(sent.length, 0);
    const res = await main(event(['ACM-3030', 'BPG-5005']));
    assert.equal(res.error.statusCode, 500);
    assert.equal(res.error.body.errorId, '20261109120000000-0e7e0e7e');
    const body = JSON.parse(sent[0].body);
    assert.match(body.error.message, /^ERP rejected order 000000101: Authorization: Bearer \[REDACTED\]$/);
  } finally { globalThis.fetch = realFetch; }
});

test('validate-cart webhook: business rule passes through; unexpected error -> valid exception op + reference, no secret', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(init); return { ok: true, status: 201, json: async () => ({ id: '20261109120000000-0badc0de' }) }; };
  try {
    const { main } = require('../actions/validate-cart');
    const base = { ERROR_MONITOR_ENDPOINT: 'https://m.invalid/record', ERROR_MONITOR_SIGNING_KEY: KEY };
    assert.deepEqual(await main({ ...base, cart: { items: [{ qty: 2 }] } }), { statusCode: 200, body: { op: 'success' } });
    assert.equal((await main({ ...base, cart: { items: [{ qty: 60 }] } })).body.message, 'Carts are limited to 50 items.');
    assert.equal(sent.length, 0, 'business-rule outcomes are not errors');
    const res = await main({ ...base, simulate: 'fail', UPSTREAM_TOKEN: f.bearer });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.op, 'exception');
    assert.match(res.body.message, /^We could not check your cart right now\. Please try again\. \(reference 20261109120000000-0badc0de\)$/);
    assert.equal(sent.length, 1);
    assert.ok(!sent[0].body.includes(f.bearer) && !JSON.stringify(res).includes(f.bearer));
  } finally { globalThis.fetch = realFetch; }
});
