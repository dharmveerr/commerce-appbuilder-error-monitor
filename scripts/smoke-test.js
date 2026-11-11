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
 *   IMS_ACCESS_TOKEN         user/service token accepted by require-adobe-auth
 *   IMS_ORG_ID               <id>@AdobeOrg
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

(async () => {
  const marker = `smoke-${Date.now()}`;
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

  console.log('\nManual: Adobe Developer Console > Project > Events registration > Debug Tracing/Journal: confirm one event of the configured type for id', out.id);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((err) => { console.error('Smoke test crashed:', err.name); process.exit(3); });
