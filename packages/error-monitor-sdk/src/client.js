'use strict';
const { coerceError, normalizePayload } = require('./normalize');
const { signedHeaders } = require('./signing');
const { fingerprint } = require('./record');
const { LIMITS } = require('./constants');

// Module-level so it survives across invocations that reuse a warm container.
const throttleState = new Map();
const MAX_THROTTLE_KEYS = 500;

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
    if (!entry || t - entry.start > throttle.windowMs) {
      if (!entry && throttleState.size >= MAX_THROTTLE_KEYS) throttleState.clear();
      throttleState.set(key, { start: t, count: 1 });
      return false;
    }
    entry.count += 1;
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

/** Records through a monitor built from the wrapper options. Never throws, even if `resolveOptions` does. */
async function safeRecord(opts, params, err, recordOptions, timeoutMs) {
  try {
    const monitor = createErrorMonitor({
      ...(opts.resolveOptions ? opts.resolveOptions(params) : optionsFromParams(params)),
      source: opts.source,
      ...(timeoutMs ? { timeoutMs } : {}),
      fetchImpl: opts.fetchImpl || globalThis.fetch,
      onTransportError: opts.onTransportError
    });
    return await monitor.record(err, recordOptions);
  } catch (e) {
    try { if (opts.onTransportError) opts.onTransportError(e); } catch (_) { /* ignore */ }
    return { recorded: false, reason: 'transport_error' };
  }
}

function requestContext(params) {
  const headers = params.__ow_headers || {};
  return {
    requestId: typeof headers['x-request-id'] === 'string' ? headers['x-request-id'] : undefined,
    activationId: process.env.__OW_ACTIVATION_ID,
    http: params.__ow_method ? { method: params.__ow_method, path: params.__ow_path || '/' } : undefined
  };
}

/** Status code of a returned server-error response (App Builder `{ error: { statusCode } }` or `{ statusCode }`), else 0. */
function serverErrorStatus(res) {
  if (!res || typeof res !== 'object') return 0;
  const inner = res.error && typeof res.error === 'object' ? res.error : res;
  const status = Number(inner.statusCode);
  return Number.isInteger(status) && status >= 500 && status <= 599 ? status : 0;
}

function responseError(res, status) {
  const inner = res.error && typeof res.error === 'object' ? res.error : res;
  const detail = inner.body && typeof inner.body === 'object' && typeof inner.body.error === 'string' ? `: ${inner.body.error}` : '';
  const e = new Error(`Action returned HTTP ${status}${detail}`);
  e.name = 'ErrorResponse';
  e.code = String(status);
  e.stack = undefined;
  return e;
}

/**
 * Wrap an App Builder action `main`. Thrown errors are recorded, then a generic 500 is returned
 * (with the record id for support correlation). Returned 5xx responses (the usual App Builder
 * `errorResponse` pattern) are recorded too and returned unchanged; disable with `recordErrorResponses: false`.
 *
 * @param {Function} handler  async (params) => response
 * @param {{source:object, recordErrorResponses?:boolean, resolveOptions?:(params)=>object, fetchImpl?:Function, onTransportError?:Function}} opts
 */
function withErrorMonitor(handler, opts = {}) {
  const recordErrorResponses = opts.recordErrorResponses !== false;
  return async function monitored(params = {}) {
    let res;
    try {
      res = await handler(params);
    } catch (err) {
      const result = await safeRecord(opts, params, err, { context: requestContext(params) });
      return { error: { statusCode: 500, body: { error: 'Internal Server Error', errorId: result.id } } };
    }
    const status = recordErrorResponses ? serverErrorStatus(res) : 0;
    if (status) {
      const context = requestContext(params);
      context.http = { ...(context.http || {}), status };
      await safeRecord(opts, params, responseError(res, status), { context });
    }
    return res;
  };
}

/**
 * Wrap a Commerce **webhook** action. Commerce expects HTTP 200 with a webhook operation, so a plain 500
 * (what withErrorMonitor returns) would make Commerce use its fallback message. On an unhandled error this
 * records it (short timeout: webhooks have tight time limits) and answers with a valid operation:
 *   onError: 'exception' (default) -> { op: 'exception', message: customerMessage + reference } stops the
 *                                     Commerce process (same outcome as today's unhandled error, but traceable)
 *   onError: 'success'             -> { op: 'success' } lets the Commerce process continue (fail open)
 * The thrown error's text is NEVER sent to Commerce: webhook exception messages can be shown to shoppers.
 *
 * @param {Function} handler async (params) => webhook response
 * @param {{source:object, onError?:'exception'|'success', customerMessage?:string, timeoutMs?:number,
 *          resolveOptions?:Function, fetchImpl?:Function, onTransportError?:Function}} opts
 */
function withWebhookErrorMonitor(handler, opts = {}) {
  const {
    onError = 'exception',
    customerMessage = 'The request could not be processed. Please try again.',
    timeoutMs = 1000
  } = opts;
  if (!['exception', 'success'].includes(onError)) throw new Error("withWebhookErrorMonitor: onError must be 'exception' or 'success'");
  if (typeof customerMessage !== 'string' || !customerMessage || customerMessage.length > 200) {
    throw new Error('withWebhookErrorMonitor: customerMessage must be a non-empty string of at most 200 characters');
  }
  return async function monitoredWebhook(params = {}) {
    try {
      return await handler(params);
    } catch (err) {
      const result = await safeRecord(opts, params, err, {
        context: { activationId: process.env.__OW_ACTIVATION_ID, tags: { kind: 'webhook', failOpen: onError === 'success' } }
      }, timeoutMs);
      if (onError === 'success') return { statusCode: 200, body: { op: 'success' } };
      const ref = result.id ? ` (reference ${result.id})` : '';
      return { statusCode: 200, body: { op: 'exception', message: `${customerMessage}${ref}` } };
    }
  };
}

module.exports = { createErrorMonitor, withErrorMonitor, withWebhookErrorMonitor, optionsFromParams };
