'use strict';
const { SEVERITIES, ID_PATTERN } = require('@commerce-ext/error-monitor-sdk');
const { loadConfig, ConfigError } = require('./config');
const { respond, log, lowerKeys } = require('./http');
const { sanitizeRecordForOutput, toSummary } = require('./output');
const { validateRecord } = require('@commerce-ext/error-monitor-sdk');

const APP_RE = /^[A-Za-z0-9@][\w.@/ -]{0,99}$/;

/** Dashboard actions: IMS token validation is done by the platform (`require-adobe-auth`); we also pin the IMS org. */
function authorize(params, config) {
  const headers = lowerKeys(params.__ow_headers);
  const org = headers['x-gw-ims-org-id'];
  return typeof org === 'string' && org === config.imsOrgId;
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

function parseListQuery(p) {
  const problems = [];
  const q = {};
  q.source = p.source === undefined ? 'state' : p.source;
  if (!['state', 'archive'].includes(q.source)) problems.push('source must be state|archive');
  q.limit = p.limit === undefined ? 25 : Number(p.limit);
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100) problems.push('limit must be 1-100');
  q.days = p.days === undefined ? 7 : Number(p.days);
  if (!Number.isInteger(q.days) || q.days < 1 || q.days > 31) problems.push('days must be 1-31');
  if (p.severity !== undefined) { if (!SEVERITIES.includes(p.severity)) problems.push('severity invalid'); q.severity = p.severity; }
  if (p.app !== undefined) { if (typeof p.app !== 'string' || !APP_RE.test(p.app)) problems.push('app invalid'); q.app = p.app; }
  if (q.source === 'archive') {
    if (typeof p.date !== 'string' || !validDate(p.date)) problems.push('date (YYYY-MM-DD) is required for archive');
    q.date = p.date;
  }
  return { q, problems };
}

async function prepare(params, mode, { deps, createDeps }) {
  let config;
  try { config = loadConfig(params, mode); } catch (e) {
    if (e instanceof ConfigError) { log('error', 'config_invalid', { problems: e.problems }); return { response: respond(500, { error: 'service_misconfigured' }) }; }
    throw e;
  }
  if (!authorize(params, config)) { log('warn', 'query_forbidden'); return { response: respond(403, { error: 'forbidden' }) }; }
  return { config, d: deps || (await createDeps(config)) };
}

/** GET /list-errors */
async function handleList(params, ctx) {
  const prep = await prepare(params, 'read', ctx);
  if (prep.response) return prep.response;
  const { config, d } = prep;
  const { q, problems } = parseListQuery(params);
  if (problems.length) return respond(400, { error: 'invalid_request', details: problems });
  const accept = (r) => validateRecord(r).length === 0 && r.commerceInstanceId === config.instanceId
    && (!q.severity || r.severity === q.severity) && (!q.app || r.source.app === q.app);
  try {
    let result;
    if (q.source === 'state') result = await d.state.listRecent({ days: q.days, limit: q.limit, now: (d.now || Date.now)(), accept });
    else if (d.archive) result = await d.archive.listDay(q.date, { limit: q.limit, accept });
    else return respond(409, { error: 'archive_disabled' });
    return respond(200, { instance: config.instanceId, source: q.source, count: result.records.length, truncated: result.truncated, records: result.records.map(toSummary) });
  } catch (e) {
    log('error', 'list_failed', { name: e && e.name });
    return respond(503, { error: 'storage_unavailable' });
  }
}

/** GET /get-error?id=...&source=state|archive (default: state, then archive) */
async function handleGet(params, ctx) {
  const prep = await prepare(params, 'read', ctx);
  if (prep.response) return prep.response;
  const { config, d } = prep;
  if (typeof params.id !== 'string' || !ID_PATTERN.test(params.id)) return respond(400, { error: 'invalid_request', details: ['id invalid'] });
  if (params.source !== undefined && !['state', 'archive'].includes(params.source)) return respond(400, { error: 'invalid_request', details: ['source must be state|archive'] });
  try {
    let record = null;
    let source = null;
    if (params.source !== 'archive') { record = await d.state.get(params.id); source = 'state'; }
    if (!record && params.source !== 'state' && d.archive) { record = await d.archive.read(params.id); source = 'archive'; }
    if (!record || validateRecord(record).length || record.commerceInstanceId !== config.instanceId) return respond(404, { error: 'not_found' });
    return respond(200, { instance: config.instanceId, source, record: sanitizeRecordForOutput(record) });
  } catch (e) {
    log('error', 'get_failed', { name: e && e.name });
    return respond(503, { error: 'storage_unavailable' });
  }
}

module.exports = { handleList, handleGet, parseListQuery, authorize };
