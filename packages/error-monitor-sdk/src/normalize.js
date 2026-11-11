'use strict';
const { SCHEMA_VERSION, SEVERITIES, LIMITS } = require('./constants');
const { sanitizeText, isSensitiveKey, REDACTED } = require('./sanitize');

class ValidationError extends Error {
  constructor(details) {
    super('invalid_error_payload');
    this.name = 'ValidationError';
    this.details = details; // list of human-readable problems; never contains submitted values
  }
}

const NAME_RE = /^[A-Za-z0-9@][\w.@/ -]{0,99}$/;
const TAG_KEY_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Accepts Error | string | {name,message,stack,code} and returns the schema's `error` shape (unsanitized). */
function coerceError(input) {
  if (input instanceof Error || (isObj(input) && 'message' in input)) {
    return { name: input.name, message: input.message, stack: input.stack, code: input.code };
  }
  if (typeof input === 'string') return { name: 'Error', message: input };
  return { name: 'Error', message: 'Non-error value thrown' };
}

function normalizeTimestamp(value, now) {
  const t = typeof value === 'string' || typeof value === 'number' ? Date.parse(value) : NaN;
  const fiveMin = 5 * 60 * 1000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (Number.isNaN(t) || t > now + fiveMin || t < now - thirtyDays) return new Date(now).toISOString();
  return new Date(t).toISOString();
}

function normalizeStack(stack, ctx) {
  if (typeof stack !== 'string' || !stack) return undefined;
  const trimmed = stack.split('\n').slice(0, LIMITS.stackLines).join('\n');
  return sanitizeText(trimmed, { max: LIMITS.stack, ctx });
}

function normalizeContext(raw, ctx, problems) {
  if (raw === undefined) return {};
  if (!isObj(raw)) { problems.push('context must be an object'); return {}; }
  const out = {};
  // ALLOW-LIST: unknown context keys (e.g. request bodies, headers) are dropped, never stored.
  if (typeof raw.requestId === 'string') out.requestId = sanitizeText(raw.requestId, { max: LIMITS.requestId, ctx });
  if (typeof raw.activationId === 'string') out.activationId = sanitizeText(raw.activationId, { max: LIMITS.requestId, ctx });
  if (isObj(raw.http)) {
    const http = {};
    if (typeof raw.http.method === 'string' && /^[A-Za-z]{3,10}$/.test(raw.http.method)) http.method = raw.http.method.toUpperCase();
    if (typeof raw.http.path === 'string') {
      // Query string and fragment are dropped entirely: they are the most common place for tokens.
      http.path = sanitizeText(raw.http.path.split(/[?#]/)[0], { max: LIMITS.path, ctx });
    }
    if (Number.isInteger(raw.http.status) && raw.http.status >= 100 && raw.http.status <= 599) http.status = raw.http.status;
    if (Object.keys(http).length) out.http = http;
  }
  if (isObj(raw.tags)) {
    const tags = {};
    for (const [k, v] of Object.entries(raw.tags).slice(0, LIMITS.tags)) {
      if (!TAG_KEY_RE.test(k)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof v)) continue;
      if (isSensitiveKey(k)) { tags[k] = REDACTED; ctx.count += 1; continue; }
      tags[k] = typeof v === 'string' ? sanitizeText(v, { max: LIMITS.tagValue, ctx }) : v;
    }
    if (Object.keys(tags).length) out.tags = tags;
  }
  return out;
}

/**
 * Normalize an (untrusted) payload to the v1 wire schema. Used on BOTH the client (SDK) and the server,
 * so the server never has to trust that the caller sanitized.
 * @returns {{payload: object, redactions: number}}
 * @throws {ValidationError}
 */
function normalizePayload(raw, { now = Date.now(), coerceSeverity = false } = {}) {
  const problems = [];
  if (!isObj(raw)) throw new ValidationError(['payload must be a JSON object']);
  const ctx = { count: 0 };

  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SCHEMA_VERSION) problems.push(`unsupported schemaVersion (expected ${SCHEMA_VERSION})`);

  let severity = raw.severity === undefined ? 'error' : raw.severity;
  if (!SEVERITIES.includes(severity)) {
    if (coerceSeverity) severity = 'error';
    else problems.push(`severity must be one of ${SEVERITIES.join(', ')}`);
  }

  const src = isObj(raw.source) ? raw.source : {};
  if (typeof src.app !== 'string' || !NAME_RE.test(src.app)) problems.push('source.app is required (1-100 chars: letters, digits, . _ @ / - space)');
  if (src.action !== undefined && (typeof src.action !== 'string' || !NAME_RE.test(src.action))) problems.push('source.action is invalid');
  const source = { app: String(src.app || '').slice(0, LIMITS.app) };
  if (typeof src.action === 'string' && NAME_RE.test(src.action)) source.action = src.action;
  if (typeof src.version === 'string') source.version = sanitizeText(src.version, { max: LIMITS.version, ctx });
  if (typeof src.environment === 'string') source.environment = sanitizeText(src.environment, { max: LIMITS.environment, ctx });

  const err = isObj(raw.error) ? raw.error : null;
  if (!err || typeof err.message !== 'string') problems.push('error.message (string) is required');

  const context = normalizeContext(raw.context, ctx, problems);
  if (problems.length) throw new ValidationError(problems);

  const error = {
    name: sanitizeText(typeof err.name === 'string' && err.name ? err.name : 'Error', { max: LIMITS.name, ctx }),
    message: sanitizeText(err.message || '(no message)', { max: LIMITS.message, ctx })
  };
  if (typeof err.code === 'string' || typeof err.code === 'number') error.code = sanitizeText(err.code, { max: LIMITS.code, ctx });
  const stack = normalizeStack(err.stack, ctx);
  if (stack) error.stack = stack;

  return {
    payload: { schemaVersion: SCHEMA_VERSION, timestamp: normalizeTimestamp(raw.timestamp, now), severity, source, error, context },
    redactions: ctx.count
  };
}

module.exports = { normalizePayload, coerceError, ValidationError };
