'use strict';
const { coerceError, normalizePayload } = require('./normalize');
const { signedHeaders } = require('./signing');
const { fingerprint } = require('./record');
const { LIMITS } = require('./constants');

// Module-level so it survives across invocations that reuse a warm container.
const throttleState = new Map();

function validateEndpoint(endpoint, allowInsecureLocalhost) {
  let u;
  try { u = new URL(endpoint); } catch (e) { return false; }
  if (u.protocol === 'https:') return true;
  return allowInsecureLocalhost && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
}

/**
 * Create a monitor bound to one Error Monitor endpoint.
 * `record()` NEVER throws and never rejects: monitoring must not break the monitored action.
 *
 * @param {object} options
 * @param {string} options.endpoint        https URL of the record-error web action
 * @param {string} options.signingKey      shared HMAC key (secret; supply via action inputs, never source)
 * @param {{app:string, action?:string, version?:string, environment?:string}} options.source
 * @param {number} [options.timeoutMs=2000]
 * @param {{maxPerWindow:number, windowMs:number}} [options.throttle]  per-fingerprint client-side limit
 * @param {Function} [options.fetchImpl]   defaults to global fetch
 * @param {(e:Error)=>void} [options.onTransportError]  hook for local logging (do not log secrets)
 */
function createErrorMonitor(options = {}) {
  const {
    endpoint, signingKey, source,
    timeoutMs = 2000,
    throttle = { maxPerWindow: 5, windowMs: 60000 },
    fetchImpl = globalThis.fetch,
    onTransportError = () => {},
    allowInsecureLocalhost = false,
    now = Date.now
  } = options;

  const configured = Boolean(endpoint && signingKey && source && validateEndpoint(endpoint, allowInsecureLocalhost) && typeof fetchImpl === 'function');

  function throttled(payload) {
    const key = fingerprint(payload);
    const t = now();
    const entry = throttleState.get(key);
    if (!entry || t - entry.start > throttle.windowMs) { throttleState.set(key, { start: t, count: 1 }); return false; }
    entry.count += 1;
    if (throttleState.size > 500) throttleState.clear(); // bound memory
    return entry.count > throttle.maxPerWindow;
  }

  async function record(errorLike, { severity = 'error', context, source: sourceOverride, timestamp } = {}) {
    try {
      if (!configured) return { recorded: false, reason: 'not_configured' };
      const { payload, redactions } = normalizePayload(
        { severity, source: { ...source, ...sourceOverride }, error: coerceError(errorLike), context, timestamp: timestamp || new Date(now()).toISOString() },
        { now: now(), coerceSeverity: true }
      );
      if (throttled(payload)) return { recorded: false, reason: 'throttled' };

      const body = JSON.stringify({ ...payload, redactions }); // client-side count; server adds its own
      if (Buffer.byteLength(body) > LIMITS.bodyBytes) return { recorded: false, reason: 'too_large' };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...signedHeaders(signingKey, body, now()) },
          body,
          signal: controller.signal,
          redirect: 'error'
        });
        if (!res.ok) return { recorded: false, reason: `http_${res.status}` };
        const json = await res.json().catch(() => ({}));
        return { recorded: true, id: typeof json.id === 'string' ? json.id : undefined };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      try { onTransportError(e); } catch (_) { /* ignore */ }
      return { recorded: false, reason: 'transport_error' };
    }
  }

  return { record, isConfigured: () => configured };
}

/** Defaults: read endpoint + key from OpenWhisk action params (set via app.config.yaml inputs / .env). */
function optionsFromParams(params = {}) {
  return { endpoint: params.ERROR_MONITOR_ENDPOINT, signingKey: params.ERROR_MONITOR_SIGNING_KEY };
}

/**
 * Wrap an App Builder action `main`. Unhandled errors are recorded, then a generic 500 is returned
 * (with the record id for support correlation). Existing actions need no other change.
 *
 * @param {Function} handler  async (params) => response
 * @param {{source:object, resolveOptions?:(params)=>object, fetchImpl?:Function}} opts
 */
function withErrorMonitor(handler, opts = {}) {
  return async function monitored(params = {}) {
    try {
      return await handler(params);
    } catch (err) {
      const monitor = createErrorMonitor({
        ...(opts.resolveOptions ? opts.resolveOptions(params) : optionsFromParams(params)),
        source: opts.source,
        fetchImpl: opts.fetchImpl || globalThis.fetch,
        onTransportError: opts.onTransportError
      });
      const headers = params.__ow_headers || {};
      const result = await monitor.record(err, {
        context: {
          requestId: typeof headers['x-request-id'] === 'string' ? headers['x-request-id'] : undefined,
          activationId: process.env.__OW_ACTIVATION_ID,
          http: params.__ow_method ? { method: params.__ow_method, path: params.__ow_path || '/' } : undefined
        }
      });
      return { error: { statusCode: 500, body: { error: 'Internal Server Error', errorId: result.id } } };
    }
  };
}

module.exports = { createErrorMonitor, withErrorMonitor, optionsFromParams };
