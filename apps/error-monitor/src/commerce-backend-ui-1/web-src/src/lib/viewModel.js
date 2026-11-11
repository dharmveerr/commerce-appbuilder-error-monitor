'use strict';
/**
 * Pure, framework-free view-model for the dashboard. All "empty / invalid / error" handling lives here so it is
 * unit-testable without a browser. React components only render what this module returns, as text nodes
 * (never as HTML), so a malicious or malformed record cannot inject markup.
 */
const { sanitizeText } = require('@commerce-ext/error-monitor-sdk/sanitize');

const SEVERITIES = ['debug', 'info', 'warning', 'error', 'critical'];
const ID_RE = /^\d{17}-[0-9a-f]{8}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function formatTimestamp(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  return `${new Date(t).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

const text = (v, max) => sanitizeText(v, { max });

function toRow(rec) {
  if (!isObj(rec) || typeof rec.id !== 'string' || !ID_RE.test(rec.id)) return null;
  if (!SEVERITIES.includes(rec.severity)) return null;
  const when = formatTimestamp(rec.timestamp);
  if (!when) return null;
  if (!isObj(rec.source) || typeof rec.source.app !== 'string') return null;
  if (!isObj(rec.error) || typeof rec.error.message !== 'string') return null;
  return {
    id: rec.id,
    severity: rec.severity,
    when,
    app: text(rec.source.app, 100),
    action: typeof rec.source.action === 'string' ? text(rec.source.action, 100) : '',
    name: text(typeof rec.error.name === 'string' ? rec.error.name : 'Error', 100),
    code: rec.error.code === undefined ? '' : text(rec.error.code, 100),
    message: text(rec.error.message, 200)
  };
}

function httpProblem(status) {
  if (status === 401 || status === 403) return 'You are not authorized to view error records for this Commerce instance.';
  if (status === 404) return 'The requested error record was not found (it may have expired from recent storage).';
  if (status >= 500) return 'The Error Monitor service is temporarily unavailable. Try again shortly.';
  return 'The request could not be completed.';
}

/** @returns {{state:'ok'|'empty'|'invalid'|'error', rows:object[], skipped:number, truncated:boolean, instance:string, message?:string}} */
function parseListResponse(status, json) {
  const base = { rows: [], skipped: 0, truncated: false, instance: '' };
  if (!(status >= 200 && status < 300)) return { ...base, state: 'error', message: httpProblem(status) };
  if (!isObj(json) || !Array.isArray(json.records)) return { ...base, state: 'invalid', message: 'The Error Monitor service returned an unexpected response.' };
  const rows = json.records.map(toRow).filter(Boolean);
  const skipped = json.records.length - rows.length;
  const instance = typeof json.instance === 'string' ? text(json.instance, 64) : '';
  if (rows.length === 0 && skipped === 0) return { ...base, instance, state: 'empty', message: 'No error records found for the selected filters.' };
  if (rows.length === 0) return { ...base, instance, skipped, state: 'invalid', message: 'Records were returned but none could be displayed (invalid format).' };
  return { state: 'ok', rows, skipped, truncated: json.truncated === true, instance };
}

/** @returns {{state:'ok'|'invalid'|'error', detail?:object, message?:string}} */
function parseDetailResponse(status, json) {
  if (!(status >= 200 && status < 300)) return { state: 'error', message: httpProblem(status) };
  const rec = isObj(json) ? json.record : null;
  const row = toRow(rec);
  if (!row) return { state: 'invalid', message: 'The error record has an unexpected format and cannot be displayed.' };
  const ctx = isObj(rec.context) ? rec.context : {};
  const tags = isObj(ctx.tags) ? Object.entries(ctx.tags).slice(0, 20).map(([k, v]) => [text(k, 40), text(v, 200)]) : [];
  return {
    state: 'ok',
    storedIn: json.source === 'archive' ? 'Archive (Files)' : 'Recent (State)',
    detail: {
      ...row,
      message: text(rec.error.message, 1020),
      fingerprint: typeof rec.fingerprint === 'string' ? text(rec.fingerprint, 32) : '',
      instance: typeof rec.commerceInstanceId === 'string' ? text(rec.commerceInstanceId, 64) : '',
      version: isObj(rec.source) && typeof rec.source.version === 'string' ? text(rec.source.version, 70) : '',
      environment: isObj(rec.source) && typeof rec.source.environment === 'string' ? text(rec.source.environment, 70) : '',
      requestId: typeof ctx.requestId === 'string' ? text(ctx.requestId, 128) : '',
      http: isObj(ctx.http) ? [ctx.http.method, ctx.http.path, ctx.http.status].filter((x) => x !== undefined).map((x) => text(x, 300)).join(' ') : '',
      stack: typeof rec.error.stack === 'string' ? text(rec.error.stack, 4020) : '',
      tags,
      redactions: Number.isInteger(rec.redactions) ? rec.redactions : 0
    }
  };
}

function buildQuery({ source, severity, app, limit, date }) {
  const q = new URLSearchParams();
  q.set('source', source === 'archive' ? 'archive' : 'state');
  q.set('limit', String(Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100)));
  if (severity && SEVERITIES.includes(severity)) q.set('severity', severity);
  if (app && /^[A-Za-z0-9@][\w.@/ -]{0,99}$/.test(app)) q.set('app', app);
  if (source === 'archive' && /^\d{4}-\d{2}-\d{2}$/.test(date || '')) q.set('date', date);
  return q.toString();
}

module.exports = { parseListResponse, parseDetailResponse, buildQuery, formatTimestamp, SEVERITIES };
