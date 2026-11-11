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
