'use strict';
const { normalizePayload, toRecord, ValidationError, verifySignature, LIMITS } = require('@commerce-ext/error-monitor-sdk');
const { loadConfig, ConfigError } = require('./config');
const { respond, log, lowerKeys } = require('./http');
const { buildCloudEvent, shouldEmit } = require('./events');

/** Raw body of a `raw-http: true` web action. JSON/text bodies arrive as-is; anything else base64. */
function getRawBody(params, headers) {
  const body = params.__ow_body;
  if (typeof body !== 'string') return null;
  return /json|text/.test(String(headers['content-type'] || '').toLowerCase()) ? body : Buffer.from(body, 'base64').toString('utf8');
}

/**
 * POST /record-error
 * 1 authenticate (HMAC) -> 2 validate+normalize (server is the authority) -> 3 State (required)
 * -> 4 Files archive (best effort, reported) -> 5 Events (best effort, reported).
 */
async function handleRecord(params, { deps, createDeps }) {
  let config;
  try { config = loadConfig(params, 'ingest'); } catch (e) {
    if (e instanceof ConfigError) { log('error', 'config_invalid', { problems: e.problems }); return respond(500, { error: 'service_misconfigured' }); }
    throw e;
  }

  const headers = lowerKeys(params.__ow_headers);
  if ((params.__ow_method || 'post').toLowerCase() !== 'post') return respond(405, { error: 'method_not_allowed' });
  const raw = getRawBody(params, headers);
  if (raw === null) return respond(400, { error: 'invalid_request', details: ['JSON body required'] });
  if (Buffer.byteLength(raw) > LIMITS.bodyBytes) return respond(413, { error: 'payload_too_large' });

  const now = (deps && deps.now) || Date.now;
  const auth = verifySignature(config.signingKey, headers, raw, { nowMs: now() });
  if (!auth.ok) { log('warn', 'ingest_unauthorized', { reason: auth.reason }); return respond(401, { error: 'unauthorized' }); }

  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return respond(400, { error: 'invalid_request', details: ['body is not valid JSON'] }); }

  let record;
  try {
    const { payload, redactions } = normalizePayload(parsed, { now: now() });
    const reported = Number.isInteger(parsed && parsed.redactions) && parsed.redactions >= 0 && parsed.redactions <= 1000 ? parsed.redactions : 0;
    record = toRecord(payload, redactions + reported, { instanceId: config.instanceId, now: now() });
  } catch (e) {
    if (e instanceof ValidationError) return respond(400, { error: 'invalid_request', details: e.details });
    throw e;
  }

  const d = deps || (await createDeps(config));
  const result = { id: record.id, stored: { state: false, archive: false }, event: { emitted: false } };

  try { await d.state.put(record); result.stored.state = true; } catch (e) {
    log('error', 'state_write_failed', { id: record.id, name: e && e.name });
    return respond(503, { error: 'storage_unavailable' });
  }

  if (d.archive) {
    try { await d.archive.write(record); result.stored.archive = true; } catch (e) {
      log('error', 'archive_write_failed', { id: record.id, name: e && e.name });
    }
  }

  if (!d.publisher || !shouldEmit(record, config.events)) {
    result.event = { emitted: false, reason: d.publisher ? 'below_threshold' : 'disabled' };
  } else {
    try { await d.publisher.publish(buildCloudEvent(record, config.events)); result.event = { emitted: true }; } catch (e) {
      log('error', 'event_publish_failed', { id: record.id, name: e && e.name });
      result.event = { emitted: false, reason: 'publish_failed' };
    }
  }

  log('info', 'error_recorded', { id: record.id, severity: record.severity, app: record.source.app, redactions: record.redactions, stored: result.stored, eventEmitted: result.event.emitted });
  return respond(201, result);
}

module.exports = { handleRecord, getRawBody };
