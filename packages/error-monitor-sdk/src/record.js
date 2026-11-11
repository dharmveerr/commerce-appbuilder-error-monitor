'use strict';
const crypto = require('node:crypto');
const { SCHEMA_VERSION, SEVERITIES, LIMITS } = require('./constants');

/** Time-sortable id: UTC yyyymmddHHMMssSSS + 8 hex. Lexicographic order == chronological order. */
const ID_PATTERN = /^\d{17}-[0-9a-f]{8}$/;
const INSTANCE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function generateId(now = Date.now(), randomHex = () => crypto.randomBytes(4).toString('hex')) {
  const stamp = new Date(now).toISOString().replace(/[-:T.Z]/g, ''); // yyyymmddHHMMssSSS (17 digits)
  return `${stamp}-${randomHex()}`;
}

/** Groups "the same" error: volatile parts (numbers, uuids, hex) are masked before hashing. */
function fingerprint(payload) {
  const msg = payload.error.message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
    .replace(/\b0x[0-9a-f]+\b/gi, '#')
    .replace(/\d+/g, '#');
  const frame = (payload.error.stack || '').split('\n').find((l) => /^\s*at\s/.test(l)) || '';
  const parts = [payload.source.app, payload.source.action || '', payload.error.name, payload.error.code || '', msg, frame.replace(/:\d+:\d+/g, '')];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/** Server-side: wrap a normalized payload into the stored ErrorRecord. */
function toRecord(payload, redactions, { instanceId, now = Date.now(), randomHex } = {}) {
  if (!INSTANCE_PATTERN.test(instanceId || '')) throw new Error('invalid instanceId');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: generateId(now, randomHex),
    fingerprint: fingerprint(payload),
    timestamp: payload.timestamp,
    receivedAt: new Date(now).toISOString(),
    commerceInstanceId: instanceId,
    severity: payload.severity,
    source: payload.source,
    error: payload.error,
    context: payload.context,
    redactions
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Strict structural validation of a stored/returned record. Returns a list of problems ([] == valid). */
function validateRecord(r) {
  const p = [];
  if (!isObj(r)) return ['record must be an object'];
  const allowed = ['schemaVersion', 'id', 'fingerprint', 'timestamp', 'receivedAt', 'commerceInstanceId', 'severity', 'source', 'error', 'context', 'redactions'];
  for (const k of Object.keys(r)) if (!allowed.includes(k)) p.push(`unknown field: ${k}`);
  if (r.schemaVersion !== SCHEMA_VERSION) p.push('schemaVersion');
  if (typeof r.id !== 'string' || !ID_PATTERN.test(r.id)) p.push('id');
  if (typeof r.fingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(r.fingerprint)) p.push('fingerprint');
  if (typeof r.timestamp !== 'string' || !ISO.test(r.timestamp)) p.push('timestamp');
  if (typeof r.receivedAt !== 'string' || !ISO.test(r.receivedAt)) p.push('receivedAt');
  if (typeof r.commerceInstanceId !== 'string' || !INSTANCE_PATTERN.test(r.commerceInstanceId)) p.push('commerceInstanceId');
  if (!SEVERITIES.includes(r.severity)) p.push('severity');
  if (!isObj(r.source) || typeof r.source.app !== 'string' || !r.source.app) p.push('source.app');
  if (!isObj(r.error) || typeof r.error.name !== 'string' || typeof r.error.message !== 'string') p.push('error.name/message');
  else {
    if (r.error.message.length > LIMITS.message + 20) p.push('error.message too long');
    if (r.error.stack !== undefined && (typeof r.error.stack !== 'string' || r.error.stack.length > LIMITS.stack + 20)) p.push('error.stack');
  }
  if (!isObj(r.context)) p.push('context');
  if (!Number.isInteger(r.redactions) || r.redactions < 0) p.push('redactions');
  return p;
}

module.exports = { generateId, fingerprint, toRecord, validateRecord, ID_PATTERN, INSTANCE_PATTERN };
