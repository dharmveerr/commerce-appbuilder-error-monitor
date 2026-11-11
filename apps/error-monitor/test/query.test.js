'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleRecord } = require('../src/commerce-backend-ui-1/actions/lib/ingest');
const { handleList, handleGet } = require('../src/commerce-backend-ui-1/actions/lib/query');
const { signedRequest, adminRequest, makeEnv, baseParams } = require('./helpers/fakes');
const f = require('../../../packages/error-monitor-sdk/test/fixtures');

const body = (res) => (typeof res.body === 'string' ? JSON.parse(res.body) : res.body);
const mk = (over = {}) => ({ source: { app: 'demo', action: 'act' }, severity: 'error', error: { name: 'E', message: 'm' }, ...over });

async function seed(env, items) {
  let t = Date.now() - items.length * 10;
  for (const it of items) {
    env.deps.now = () => t; // distinct, increasing ids
    // eslint-disable-next-line no-await-in-loop
    await handleRecord(signedRequest(it, { nowMs: t }), { deps: { ...env.deps, now: () => t } });
    t += 10;
  }
  env.deps.now = () => Date.now();
}

test('AC2: recent records are retrievable from State (newest first) and archived records from Files', async () => {
  const env = makeEnv();
  await seed(env, [mk({ error: { name: 'E', message: 'first' } }), mk({ error: { name: 'E', message: 'second' } }), mk({ error: { name: 'E', message: 'third' } })]);

  const list = await handleList(adminRequest({ limit: '2' }), { deps: env.deps });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(body(list).records.map((r) => r.error.message), ['third', 'second']);
  assert.equal(body(list).instance, 'stage-1');

  const id = body(list).records[0].id;
  const got = body(await handleGet(adminRequest({ id }), { deps: env.deps }));
  assert.equal(got.source, 'state');
  assert.equal(got.record.error.message, 'third');

  // archive listing (today) + detail from Files when State has expired
  const today = new Date().toISOString().slice(0, 10);
  const arch = body(await handleList(adminRequest({ source: 'archive', date: today }), { deps: env.deps }));
  assert.equal(arch.count, 3);
  env.state.m.clear(); // simulate TTL expiry
  const fromFiles = body(await handleGet(adminRequest({ id }), { deps: env.deps }));
  assert.equal(fromFiles.source, 'archive');
  assert.equal(fromFiles.record.id, id);
  assert.equal(body(await handleList(adminRequest({}), { deps: env.deps })).count, 0, 'State no longer lists expired records');
});

test('filters by severity and application', async () => {
  const env = makeEnv();
  await seed(env, [mk({ severity: 'warning' }), mk({ severity: 'critical', source: { app: 'other' } }), mk({ severity: 'critical' })]);
  assert.equal(body(await handleList(adminRequest({ severity: 'critical' }), { deps: env.deps })).count, 2);
  assert.equal(body(await handleList(adminRequest({ severity: 'critical', app: 'other' }), { deps: env.deps })).count, 1);
});

test('AC5: empty store returns an empty list (not an error)', async () => {
  const env = makeEnv();
  const res = await handleList(adminRequest({}), { deps: env.deps });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(body(res).records, []);
  assert.equal((await handleGet(adminRequest({ id: '20261109120000000-aaaaaaaa' }), { deps: env.deps })).statusCode, 404);
});

test('AC5: invalid or corrupted stored data is skipped / 404, never returned', async () => {
  const env = makeEnv();
  await seed(env, [mk()]);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  env.state.m.set(`e.stage-1.${today}.${today}000000000-bbbbbbbb`, { value: '{not json' });
  env.state.m.set(`e.stage-1.${today}.${today}000000001-cccccccc`, { value: JSON.stringify({ id: 'x', hacked: true }) });
  const res = body(await handleList(adminRequest({}), { deps: env.deps }));
  assert.equal(res.count, 1);
  assert.equal((await handleGet(adminRequest({ id: `${today}000000001-cccccccc` }), { deps: env.deps })).statusCode, 404);
});

test('AC5: invalid query parameters are rejected with 400 (including injection / traversal attempts)', async () => {
  const env = makeEnv();
  for (const q of [{ limit: '0' }, { limit: '1000' }, { limit: 'abc' }, { days: '99' }, { severity: 'fatal' }, { app: '../../etc' }, { source: 'archive' }, { source: 'archive', date: '2026-13-45' }, { source: 'archive', date: '../../../x' }, { source: 'other' }]) {
    const res = await handleList(adminRequest(q), { deps: env.deps });
    assert.equal(res.statusCode, 400, JSON.stringify(q));
  }
  for (const id of ['', '../../etc/passwd', '2026*', 'x'.repeat(5000)]) assert.equal((await handleGet(adminRequest({ id }), { deps: env.deps })).statusCode, 400);
});

test('authorization: wrong or missing IMS org -> 403; instance mismatch records are hidden', async () => {
  const env = makeEnv();
  await seed(env, [mk()]);
  assert.equal((await handleList(adminRequest({}, { org: 'OTHER@AdobeOrg' }), { deps: env.deps })).statusCode, 403);
  assert.equal((await handleList({ ...adminRequest({}), __ow_headers: {} }, { deps: env.deps })).statusCode, 403);
  assert.equal((await handleGet(adminRequest({ id: '20261109120000000-aaaaaaaa' }, { org: 'OTHER@AdobeOrg' }), { deps: env.deps })).statusCode, 403);
  // fail closed if IMS_ORG_ID is not configured at all
  assert.equal((await handleList(adminRequest({}, { params: baseParams({ IMS_ORG_ID: undefined }) }), { deps: env.deps })).statusCode, 500);
  // a record from another instance planted in the same store is not shown
  const [[k, v]] = [...env.state.m.entries()];
  const planted = { ...JSON.parse(v.value), commerceInstanceId: 'prod-9' };
  env.state.m.set(k, { value: JSON.stringify(planted) });
  assert.equal(body(await handleList(adminRequest({}), { deps: env.deps })).count, 0);
});

test('AC6: dashboard API output re-sanitizes even if a legacy record in storage contains sensitive values', async () => {
  const env = makeEnv();
  await seed(env, [mk()]);
  const [[k, v]] = [...env.state.m.entries()];
  const rec = JSON.parse(v.value);
  rec.error.message = f.dirtyMessage;
  rec.error.stack = `E\n at h (${f.stripe})`;
  rec.context = { tags: { password: f.password, note: `token=${f.bearer}` }, http: { path: `/x/${f.jwt}` } };
  env.state.m.set(k, { value: JSON.stringify(rec) });
  const out = JSON.stringify([await handleList(adminRequest({}), { deps: env.deps }), await handleGet(adminRequest({ id: rec.id }), { deps: env.deps })]);
  for (const s of f.SENSITIVE_VALUES) assert.ok(!out.includes(s), `leaked ${s.slice(0, 6)}…`);
});

test('archive disabled -> 409 for archive listing', async () => {
  const env = makeEnv({ archive: null });
  assert.equal((await handleList(adminRequest({ source: 'archive', date: '2026-11-09' }), { deps: env.deps })).statusCode, 409);
});

test('storage failure -> 503 with generic body', async () => {
  const env = makeEnv();
  env.deps.state = { listRecent: async () => { throw new Error(`secret detail ${f.password}`); } };
  const res = await handleList(adminRequest({}), { deps: env.deps });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(body(res), { error: 'storage_unavailable' });
});
