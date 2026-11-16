'use strict';
const crypto = require('node:crypto');
const { HEADERS } = require('./constants');

/** HMAC-SHA256 over `${timestampSeconds}.${rawBody}`. */
function sign(key, timestampSeconds, body) {
  return crypto.createHmac('sha256', key).update(`${timestampSeconds}.${body}`).digest('hex');
}

function signedHeaders(key, body, nowMs = Date.now()) {
  const ts = Math.floor(nowMs / 1000);
  return { [HEADERS.timestamp]: String(ts), [HEADERS.signature]: `v1=${sign(key, ts, body)}` };
}

/**
 * Verify an incoming request. Header names must be lower-case (OpenWhisk lower-cases them).
 * @returns {{ok: boolean, reason?: string}} reason is for server-side logs only, never returned to callers.
 */
function verifySignature(key, headers, body, { nowMs = Date.now(), toleranceSeconds = 300 } = {}) {
  const ts = headers && headers[HEADERS.timestamp];
  const sig = headers && headers[HEADERS.signature];
  if (!key) return { ok: false, reason: 'no_key_configured' };
  if (typeof ts !== 'string' || typeof sig !== 'string') return { ok: false, reason: 'missing_headers' };
  if (!/^\d{9,12}$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(Math.floor(nowMs / 1000) - Number(ts)) > toleranceSeconds) return { ok: false, reason: 'stale_timestamp' };
  const m = /^v1=([0-9a-f]{64})$/.exec(sig);
  if (!m) return { ok: false, reason: 'bad_signature_format' };
  const expected = Buffer.from(sign(key, ts, body), 'hex');
  const actual = Buffer.from(m[1], 'hex');
  return crypto.timingSafeEqual(expected, actual) ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

module.exports = { sign, signedHeaders, verifySignature };
