'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePayload, coerceError, ValidationError } = require('../src/normalize');
const { toRecord, validateRecord, ID_PATTERN } = require('../src/record');
const schema = require('../schema/error-record.v1.schema.json');
const f = require('./fixtures');

const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const base = (over = {}) => ({ source: { app: 'demo-app', action: 'act' }, error: { name: 'TypeError', message: 'boom 42', stack: 'TypeError: boom\n    at fn (/srv/a.js:1:2)' }, ...over });

test('AC1: normalizes to the agreed schema and the stored record validates', () => {
  const { payload, redactions } = normalizePayload(base({ severity: 'critical', context: { requestId: 'r-1' } }), { now: NOW });
  assert.deepEqual(Object.keys(payload).sort(), ['context', 'error', 'schemaVersion', 'severity', 'source', 'timestamp']);
  const rec = toRecord(payload, redactions, { instanceId: 'stage-1', now: NOW });
  assert.deepEqual(validateRecord(rec), []);
  assert.match(rec.id, ID_PATTERN);
  assert.equal(rec.commerceInstanceId, 'stage-1');
  assert.equal(rec.schemaVersion, '1.0');
  // every key in the record is declared by the published JSON schema (no drift between schema file and code)
  assert.deepEqual(Object.keys(rec).sort(), Object.keys(schema.properties).sort());
  assert.deepEqual(schema.required.slice().sort(), Object.keys(schema.properties).sort());
});

test('ids sort chronologically', () => {
  const a = toRecord(normalizePayload(base(), { now: NOW }).payload, 0, { instanceId: 'i', now: NOW }).id;
  const b = toRecord(normalizePayload(base(), { now: NOW + 5 }).payload, 0, { instanceId: 'i', now: NOW + 5 }).id;
  assert.ok(a < b);
});

test('fingerprint groups volatile values but separates different errors', () => {
  const mk = (msg) => toRecord(normalizePayload(base({ error: { name: 'E', message: msg } }), { now: NOW }).payload, 0, { instanceId: 'i', now: NOW }).fingerprint;
  assert.equal(mk('order 123 failed'), mk('order 98765 failed'));
  assert.notEqual(mk('order 123 failed'), mk('payment 123 failed'));
});

test('sanitizes every free-text field and counts redactions', () => {
  const { payload, redactions } = normalizePayload(base({
    error: { name: 'E', message: f.dirtyMessage, stack: `E: x\n    at /srv/a.js (${f.stripe})` },
    context: { requestId: f.email, http: { method: 'post', path: `/cb?token=${f.bearer}`, status: 502 }, tags: { region: 'emea', apiKey: f.stripe, note: `password: ${f.password}` } }
  }), { now: NOW });
  const json = JSON.stringify(payload);
  for (const v of f.SENSITIVE_VALUES) assert.ok(!json.includes(v), `leaked: ${v.slice(0, 8)}…`);
  assert.equal(payload.context.http.path, '/cb');
  assert.equal(payload.context.tags.apiKey, '[REDACTED]');
  assert.ok(redactions >= 8);
});

test('allow-list: unknown context keys (e.g. request bodies/headers) are dropped', () => {
  const { payload } = normalizePayload(base({ context: { requestBody: { card: f.card }, headers: { authorization: f.bearer }, tags: { ok: 1 } } }), { now: NOW });
  assert.deepEqual(Object.keys(payload.context), ['tags']);
});

test('rejects invalid input with details that do not echo values', () => {
  assert.throws(() => normalizePayload('nope'), ValidationError);
  assert.throws(() => normalizePayload({ source: {}, error: {} }), (e) => e instanceof ValidationError && e.details.length >= 2);
  assert.throws(() => normalizePayload(base({ severity: `<script>${f.password}` })), (e) => !JSON.stringify(e.details).includes(f.password));
  assert.throws(() => normalizePayload(base({ schemaVersion: '9.9' })), ValidationError);
});

test('client mode coerces severity, bad timestamps are replaced, size limits applied', () => {
  const { payload } = normalizePayload(base({ severity: 'nope', timestamp: 'garbage', error: { name: 'E', message: 'm'.repeat(5000) } }), { now: NOW, coerceSeverity: true });
  assert.equal(payload.severity, 'error');
  assert.equal(payload.timestamp, '2026-11-09T12:00:00.000Z');
  assert.ok(payload.error.message.length < 1100);
});

test('coerceError handles Error, string, object and junk', () => {
  assert.equal(coerceError(new RangeError('x')).name, 'RangeError');
  assert.equal(coerceError('plain').message, 'plain');
  assert.equal(coerceError({ message: 'm', code: 'E_X' }).code, 'E_X');
  assert.match(coerceError(undefined).message, /Non-error/);
});

test('validateRecord rejects tampered/unknown shapes', () => {
  const rec = toRecord(normalizePayload(base(), { now: NOW }).payload, 0, { instanceId: 'i', now: NOW });
  assert.ok(validateRecord({ ...rec, extra: 1 }).length);
  assert.ok(validateRecord({ ...rec, id: '../../etc/passwd' }).length);
  assert.ok(validateRecord(null).length);
});
