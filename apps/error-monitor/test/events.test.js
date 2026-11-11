'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventPublisher, buildCloudEvent, shouldEmit } = require('../src/commerce-backend-ui-1/actions/lib/events');
const { loadConfig, ConfigError } = require('../src/commerce-backend-ui-1/actions/lib/config');
const { baseParams } = require('./helpers/fakes');

const events = loadConfig(baseParams()).events;
const rec = { id: '20261109120000000-aaaaaaaa', fingerprint: 'f'.repeat(32), commerceInstanceId: 'stage-1', severity: 'critical', receivedAt: '2026-11-09T12:00:00.000Z', source: { app: 'a', action: 'b' }, error: { name: 'E', message: 'm'.repeat(500), stack: 'secret-ish stack' } };

test('cloud event is a valid CloudEvents 1.0 summary without stack', () => {
  const ev = buildCloudEvent(rec, events);
  assert.equal(ev.specversion, '1.0');
  assert.equal(ev.datacontenttype, 'application/json');
  assert.equal(ev.data.message.length, 200);
  assert.ok(!JSON.stringify(ev).includes('secret-ish'));
});

test('severity gate', () => {
  assert.equal(shouldEmit({ severity: 'warning' }, events), false);
  assert.equal(shouldEmit({ severity: 'error' }, events), true);
  assert.equal(shouldEmit({ severity: 'critical' }, { ...events, enabled: false }), false);
});

test('publisher: fetches an IMS token once (cached) and publishes via aio-lib-events', async () => {
  let tokenCalls = 0;
  const init = [];
  const published = [];
  const fetchImpl = async (url, opts) => {
    tokenCalls += 1;
    assert.equal(url, 'https://ims-na1.adobelogin.com/ims/token/v3');
    assert.match(opts.body, /grant_type=client_credentials/);
    return { ok: true, json: async () => ({ access_token: 'synthetic-token', expires_in: 86399 }) };
  };
  const eventsFactory = { init: async (...a) => { init.push(a); return { publishEvent: async (e) => { published.push(e); } }; } };
  const pub = createEventPublisher(events, { fetchImpl, eventsFactory });
  await pub.publish({ id: 1 });
  await pub.publish({ id: 2 });
  assert.equal(tokenCalls, 1);
  assert.deepEqual(init[0], [events.imsOrgId, 'client-id', 'synthetic-token']);
  assert.equal(published.length, 2);
});

test('publisher: IMS failure surfaces as an error (caller records publish_failed)', async () => {
  const pub = createEventPublisher(events, { fetchImpl: async () => ({ ok: false, status: 401 }), eventsFactory: { init: async () => ({}) } });
  await assert.rejects(() => pub.publish({}), /ims_token_http_401/);
});

test('config: reports names of bad settings, never values', () => {
  try { loadConfig({ COMMERCE_INSTANCE_ID: 'bad id!', INGEST_SIGNING_KEY: 'super-secret-but-short' }); assert.fail('should throw'); } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.ok(e.problems.length >= 2);
    assert.ok(!JSON.stringify(e.problems).includes('super-secret'));
    assert.ok(!JSON.stringify(e.problems).includes('bad id'));
  }
  assert.throws(() => loadConfig(baseParams({ IMS_TOKEN_URL: 'http://insecure.example' })), ConfigError);
  assert.throws(() => loadConfig(baseParams({ IMS_ORG_ID: 'nope' }), 'read'), ConfigError);
  assert.throws(() => loadConfig(baseParams({ STATE_TTL_SECONDS: '5' })), ConfigError);
});
