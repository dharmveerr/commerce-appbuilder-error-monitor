'use strict';
const { sanitizeText, isSensitiveKey, REDACTED } = require('@commerce-ext/error-monitor-sdk');

/**
 * Output-side sanitization (defence in depth): even if a record was stored by an older/buggy version,
 * what leaves the API is re-masked. Also trims to the fields the dashboard needs.
 */
function sanitizeRecordForOutput(r) {
  const out = JSON.parse(JSON.stringify(r));
  out.error.name = sanitizeText(out.error.name, { max: 120 });
  out.error.message = sanitizeText(out.error.message, { max: 1020 });
  if (out.error.code !== undefined) out.error.code = sanitizeText(out.error.code, { max: 120 });
  if (out.error.stack !== undefined) out.error.stack = sanitizeText(out.error.stack, { max: 4020 });
  if (out.source.version) out.source.version = sanitizeText(out.source.version, { max: 70 });
  if (out.context) {
    for (const k of ['requestId', 'activationId']) if (out.context[k]) out.context[k] = sanitizeText(out.context[k], { max: 128 });
    if (out.context.http && out.context.http.path) out.context.http.path = sanitizeText(out.context.http.path, { max: 300 });
    if (out.context.tags) {
      for (const [k, v] of Object.entries(out.context.tags)) {
        out.context.tags[k] = isSensitiveKey(k) ? REDACTED : (typeof v === 'string' ? sanitizeText(v, { max: 200 }) : v);
      }
    }
  }
  return out;
}

function toSummary(r) {
  const s = sanitizeRecordForOutput(r);
  return {
    id: s.id, timestamp: s.timestamp, severity: s.severity, fingerprint: s.fingerprint,
    source: { app: s.source.app, action: s.source.action },
    error: { name: s.error.name, code: s.error.code, message: s.error.message.slice(0, 200) }
  };
}

module.exports = { sanitizeRecordForOutput, toSummary };
