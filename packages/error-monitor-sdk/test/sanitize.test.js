'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeText, isSensitiveKey } = require('../src/sanitize');
const f = require('./fixtures');

test('masks each class of sensitive value', () => {
  const cases = { jwt: f.jwt, bearer: `Bearer ${f.bearer}`, aws: f.aws, stripe: f.stripe, github: f.github, email: f.email, card: f.card, key: f.privateKey, pw: `password=${f.password}` };
  for (const [name, value] of Object.entries(cases)) {
    const out = sanitizeText(`before ${value} after`);
    for (const frag of [f.jwt, f.bearer, f.aws, f.stripe, f.github, f.email, f.card, f.password, 'MIIFAKEKEYBODY']) {
      if (value.includes(frag)) assert.ok(!out.includes(frag), `${name}: leaked ${frag}`);
    }
    assert.match(out, /^before .*REDACTED.* after$|^before .*REDACTED/s, name);
  }
});

test('drops credentials and tokens inside URLs but keeps harmless params', () => {
  const out = sanitizeText(`GET https://u:${f.password}@host.example/api?access_token=zzz111&page=2#frag`);
  assert.ok(!out.includes(f.password));
  assert.ok(!out.includes('zzz111'));
  assert.ok(out.includes('page=2'));
});

test('Luhn-invalid digit runs and normal ids are NOT masked', () => {
  const text = 'order 1234567890123 id 20261109120000123-abcd1234 uuid 123e4567-e89b-12d3-a456-426614174000';
  assert.equal(sanitizeText(text), text);
});

test('counts redactions and truncates', () => {
  const ctx = { count: 0 };
  sanitizeText(`a ${f.email} b ${f.aws}`, { ctx });
  assert.equal(ctx.count, 2);
  const long = sanitizeText('x '.repeat(2000), { max: 50 });
  assert.ok(long.length < 80 && long.endsWith('[truncated]'));
});

test('strips control characters (log injection)', () => {
  assert.equal(sanitizeText('a\r\nb\u001b[31mc'), 'a\nb[31mc');
});

test('sensitive key detection', () => {
  for (const k of ['password', 'Authorization', 'x-api-key', 'client_secret', 'accessToken', 'Set-Cookie', 'cvv', 'key']) assert.ok(isSensitiveKey(k), k);
  for (const k of ['orderId', 'region', 'author', 'status']) assert.ok(!isSensitiveKey(k), k);
});

test('KNOWN LIMITATION (documented, risk R2): a bare short secret with no marker/known shape cannot be detected', () => {
  // Pattern-based redaction only recognises secrets by key name, label ("password:", "Bearer"), or well-known shape.
  // This test pins the boundary so any future detection improvement is a conscious, reviewed change.
  assert.equal(sanitizeText(`requestId ${f.bearer}`), `requestId ${f.bearer}`);
});
