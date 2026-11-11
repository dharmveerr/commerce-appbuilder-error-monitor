'use strict';
// In-memory stand-ins for Adobe I/O State / Files / Events with the same call surface the app uses.
const { signedHeaders } = require('@commerce-ext/error-monitor-sdk');

function fakeState() {
  const m = new Map();
  return {
    m,
    async put(key, value, opts) { m.set(key, { value, ttl: opts && opts.ttl }); },
    async get(key) { const e = m.get(key); return e ? { value: e.value } : undefined; },
    async *list({ match }) {
      const prefix = match.replace(/\*$/, '');
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix));
      for (let i = 0; i < keys.length; i += 2) yield { keys: keys.slice(i, i + 2) }; // small pages to exercise paging
    }
  };
}

function fakeFiles() {
  const m = new Map();
  return {
    m,
    async write(path, content) { m.set(path, Buffer.from(content)); },
    async read(path) { if (!m.has(path)) throw new Error('not found'); return m.get(path); },
    async list(dir) { return [...m.keys()].filter((k) => k.startsWith(dir)); }
  };
}

const KEY = 'a-test-only-signing-key-that-is-long-enough-0123';
const ORG = 'TESTORG123@AdobeOrg';

const baseParams = (over = {}) => ({
  COMMERCE_INSTANCE_ID: 'stage-1', INGEST_SIGNING_KEY: KEY, IMS_ORG_ID: ORG,
  EVENT_PROVIDER_ID: '00000000-0000-4000-8000-000000000000', EVENT_MIN_SEVERITY: 'error',
  IMS_CLIENT_ID: 'client-id', IMS_CLIENT_SECRET: 'client-secret', ...over
});

/** Build an OpenWhisk-style raw-http request for record-error. */
function signedRequest(payload, { key = KEY, nowMs = Date.now(), tamper = false, params = baseParams() } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const headers = { 'content-type': 'application/json', ...signedHeaders(key, body, nowMs) };
  return { ...params, __ow_method: 'post', __ow_headers: headers, __ow_body: tamper ? `${body} ` : body };
}

const adminRequest = (query = {}, { org = ORG, params = baseParams() } = {}) => ({ ...params, ...query, __ow_method: 'get', __ow_headers: { 'x-gw-ims-org-id': org } });

function makeEnv(over = {}) {
  const { createStateStore, createArchiveStore } = require('../../src/commerce-backend-ui-1/actions/lib/stores');
  const state = fakeState();
  const files = fakeFiles();
  const published = [];
  const deps = {
    state: createStateStore(state, { instanceId: 'stage-1', ttl: 604800 }),
    archive: createArchiveStore(files, { instanceId: 'stage-1' }),
    publisher: { async publish(ev) { published.push(ev); } },
    now: () => Date.now(),
    ...over
  };
  return { state, files, published, deps };
}

module.exports = { fakeState, fakeFiles, signedRequest, adminRequest, baseParams, makeEnv, KEY, ORG };
