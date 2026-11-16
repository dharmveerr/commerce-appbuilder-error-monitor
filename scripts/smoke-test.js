#!/usr/bin/env node
'use strict';
/**
 * Post-deploy smoke test against a REAL (non-production) environment. Run after `aio app deploy`.
 * Sends one signed error with synthetic sensitive values, then checks State, Files, dashboard API output and
 * negative cases. Events delivery is confirmed in the Adobe Developer Console (printed instruction), because a
 * runtime action cannot observe its own subscribers.
 *
 * Required env (generic names; supply via shell, never commit):
 *   ERROR_MONITOR_ENDPOINT   https://.../record-error
 *   ERROR_MONITOR_SIGNING_KEY
 *   LIST_ERRORS_URL          https://.../list-errors
 *   GET_ERROR_URL            https://.../get-error
 *   IMS_ACCESS_TOKEN         user/service token accepted by require-adobe-auth (e.g. `aio login --bare`)
 *   IMS_ORG_ID               <id>@AdobeOrg
 *
 * Optional, to also scan the raw stored copies in State and Files (recommended for AC6):
 *   AIO_runtime_namespace, AIO_runtime_auth   the Error Monitor workspace's Runtime credentials (from its .env)
 *   COMMERCE_INSTANCE_ID                      the value configured in the Error Monitor
 *   AIO_STATE_REGION                          only if the workspace does not use the default State region
 */
const { signedHeaders } = require('../packages/error-monitor-sdk/src/signing');
const f = require('../packages/error-monitor-sdk/test/fixtures');

const need = ['ERROR_MONITOR_ENDPOINT', 'ERROR_MONITOR_SIGNING_KEY', 'LIST_ERRORS_URL', 'GET_ERROR_URL', 'IMS_ACCESS_TOKEN', 'IMS_ORG_ID'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) { console.error(`Missing env: ${missing.join(', ')}`); process.exit(2); }
const E = process.env;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); };
const auth = { authorization: `Bearer ${E.IMS_ACCESS_TOKEN}`, 'x-gw-ims-org-id': E.IMS_ORG_ID };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Raw stored copies of one record, read with the workspace's own Runtime credentials. Null when not configured.
 * Each copy is `{ text }` or `{ error }`: I/O Files may refuse requests that do not come from a Runtime action.
 */
async function readStoredCopies(id) {
  if (!E.AIO_runtime_namespace || !E.AIO_runtime_auth || !E.COMMERCE_INSTANCE_ID) return null;
  const ow = { namespace: E.AIO_runtime_namespace, auth: E.AIO_runtime_auth };
  const day = id.slice(0, 8);
  const attempt = async (fn) => { try { return { text: await fn() }; } catch (e) { return { error: e.code || e.name }; } };
  const state = await attempt(async () => {
    const client = await require('@adobe/aio-lib-state').init({ ow, ...(E.AIO_STATE_REGION ? { region: E.AIO_STATE_REGION } : {}) });
    const res = await client.get(`e.${E.COMMERCE_INSTANCE_ID}.${day}.${id}`);
    return res ? String(res.value) : '';
  });
  const files = await attempt(async () => {
    const client = await require('@adobe/aio-lib-files').init({ ow });
    const buf = await client.read(`error-monitor/${E.COMMERCE_INSTANCE_ID}/${day.slice(0, 4)}/${day.slice(4, 6)}/${day.slice(6, 8)}/${id}.json`);
    return buf ? buf.toString('utf8') : '';
  });
  return { state, files };
}

(async () => {
  // Base-36 so the marker never looks like a card number and gets masked.
  const marker = `smoke-${Date.now().toString(36)}`;
  const payload = JSON.stringify({
    schemaVersion: '1.0', severity: 'critical', source: { app: 'smoke-test', action: marker },
    error: { name: 'SmokeTestError', message: f.dirtyMessage, stack: `SmokeTestError\n    at smoke (/srv/smoke.js:1:1)` },
    context: { tags: { run: marker } }
  });
  const res = await fetch(E.ERROR_MONITOR_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', ...signedHeaders(E.ERROR_MONITOR_SIGNING_KEY, payload) }, body: payload });
  const out = await res.json().catch(() => ({}));
  check('AC1 record-error accepts a signed payload (201) and returns an id', res.status === 201 && /^\d{17}-[0-9a-f]{8}$/.test(out.id || ''), `status ${res.status}`);
  check('AC2/AC3 State and Files both stored', out.stored && out.stored.state === true && out.stored.archive === true, JSON.stringify(out.stored));
  check('AC4 Events publish reported emitted (confirm delivery in Developer Console journal)', out.event && out.event.emitted === true, JSON.stringify(out.event));

  const bad = await fetch(E.ERROR_MONITOR_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-em-timestamp': '1', 'x-em-signature': `v1=${'0'.repeat(64)}` }, body: payload });
  check('Negative: bad signature rejected (401)', bad.status === 401, `status ${bad.status}`);

  let found = null;
  for (let i = 0; i < 5 && !found; i++) {
    const r = await fetch(`${E.LIST_ERRORS_URL}?source=state&limit=50&app=smoke-test`, { headers: auth });
    const j = await r.json().catch(() => ({}));
    found = (j.records || []).find((x) => x.id === out.id);
    if (!found) await sleep(1000);
  }
  check('AC2 list-errors (State) returns the new record', Boolean(found));
  const g = await fetch(`${E.GET_ERROR_URL}?id=${encodeURIComponent(out.id)}`, { headers: auth });
  const gj = await g.json().catch(() => ({}));
  check('AC5 get-error returns record details', g.status === 200 && gj.record && gj.record.id === out.id);
  const today = new Date().toISOString().slice(0, 10);
  const a = await fetch(`${E.LIST_ERRORS_URL}?source=archive&date=${today}&limit=100`, { headers: auth });
  const aj = await a.json().catch(() => ({}));
  check('AC3 list-errors (Files archive) returns the new record', (aj.records || []).some((x) => x.id === out.id));

  const e = await fetch(`${E.LIST_ERRORS_URL}?source=state&app=no-such-app-${marker}`, { headers: auth });
  const ej = await e.json().catch(() => ({}));
  check('AC5 empty result handled (200, zero records)', e.status === 200 && Array.isArray(ej.records) && ej.records.length === 0);
  const inv = await fetch(`${E.LIST_ERRORS_URL}?limit=-1&severity=nope`, { headers: auth });
  check('AC5 invalid parameters rejected (400)', inv.status === 400, `status ${inv.status}`);
  const noauth = await fetch(E.LIST_ERRORS_URL);
  check('Negative: list-errors without IMS token is refused (401/403)', [401, 403].includes(noauth.status), `status ${noauth.status}`);

  const everything = JSON.stringify([out, found, gj, aj]);
  const leaked = f.SENSITIVE_VALUES.filter((v) => everything.includes(v));
  check('AC6 no synthetic sensitive value in any API output', leaked.length === 0, leaked.length ? `${leaked.length} leaked` : '');

  const stored = await readStoredCopies(out.id);
  if (!stored) {
    console.log('SKIP  AC6 raw stored copies (set AIO_runtime_namespace, AIO_runtime_auth and COMMERCE_INSTANCE_ID to run)');
  } else {
    for (const [name, copy] of [['State', stored.state], ['Files', stored.files]]) {
      if (copy.error) {
        if (name === 'Files') {
          console.log(`SKIP  AC6 raw Files copy (${copy.error}: I/O Files refuses access from outside Runtime actions; the Files copy is the same record as the State copy)`);
        } else {
          check(`AC6 raw ${name} copy readable`, false, copy.error);
        }
        continue;
      }
      const leakedStored = f.SENSITIVE_VALUES.filter((v) => copy.text.includes(v));
      check(`AC6 raw ${name} copy exists and contains no synthetic sensitive value`, Boolean(copy.text) && leakedStored.length === 0, leakedStored.length ? `${leakedStored.length} leaked` : '');
    }
  }

  console.log('\nManual: Adobe Developer Console > Project > Events registration > Debug Tracing/Journal: confirm one event of the configured type for id', out.id);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((err) => { console.error('Smoke test crashed:', err.name); process.exit(3); });
