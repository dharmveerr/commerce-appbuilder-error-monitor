'use strict';
const { ID_PATTERN, INSTANCE_PATTERN } = require('@commerce-ext/error-monitor-sdk');

const MAX_SCAN_KEYS = 5000;  // per-day key scan cap (keys are sorted after the scan, so this bounds memory only)
const MAX_FETCH = 300;       // total record reads per list request
const READ_BATCH = 20;       // parallel reads per batch
const FILES_PAGE = 1000;     // aio-lib-files returns at most one page of this size per folder listing
const DAY_MS = 86400000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

const parse = (v) => {
  try { return typeof v === 'string' ? JSON.parse(v) : (Buffer.isBuffer(v) ? JSON.parse(v.toString('utf8')) : v); } catch (e) { return null; }
};

/**
 * Reads `ids` newest-first in parallel batches until `limit` accepted records or the fetch budget is used.
 * @returns {Promise<{records: object[], fetched: number, exhausted: boolean}>}
 */
async function collect(ids, read, { limit, accept, budget }) {
  const records = [];
  let fetched = 0;
  let i = 0;
  while (i < ids.length && records.length < limit && fetched < budget) {
    const batch = ids.slice(i, i + Math.min(READ_BATCH, budget - fetched));
    i += batch.length;
    fetched += batch.length;
    const results = await Promise.all(batch.map(read));
    for (const rec of results) {
      if (records.length >= limit) break;
      if (rec && accept(rec)) records.push(rec);
    }
  }
  return { records, fetched, exhausted: i >= ids.length };
}

/**
 * Recent-records store on Adobe I/O State.
 * Key: e.<instance>.<yyyymmdd>.<id>  (id is time-prefixed, so key order == time order).
 * `state` is an initialised @adobe/aio-lib-state client (or a test fake with the same surface).
 */
function createStateStore(state, { instanceId, ttl }) {
  if (!INSTANCE_PATTERN.test(instanceId)) throw new Error('invalid instanceId');
  const prefix = `e.${instanceId}.`;
  const keyFor = (id) => `${prefix}${id.slice(0, 8)}.${id}`;
  const readKey = async (key) => {
    const res = await state.get(key);
    return res ? parse(res.value) : null;
  };

  async function listKeys(day) {
    const keys = [];
    let capped = false;
    for await (const page of state.list({ match: `${prefix}${day}.*`, countHint: 1000 })) {
      keys.push(...page.keys);
      if (keys.length >= MAX_SCAN_KEYS) { capped = true; break; }
    }
    return { keys: keys.slice(0, MAX_SCAN_KEYS).sort().reverse(), capped };
  }

  return {
    async put(record) {
      await state.put(keyFor(record.id), JSON.stringify(record), { ttl });
    },
    async get(id) {
      if (!ID_PATTERN.test(id)) return null;
      return readKey(keyFor(id));
    },
    /** Newest-first. `accept(record)` applies caller filters; scanning stops at `limit` matches. */
    async listRecent({ days = 7, limit = 25, now = Date.now(), accept = () => true } = {}) {
      const records = [];
      let budget = MAX_FETCH;
      let truncated = false;
      for (let i = 0; i < days && records.length < limit; i++) {
        const { keys, capped } = await listKeys(ymd(now - i * DAY_MS));
        const got = await collect(keys, readKey, { limit: limit - records.length, accept, budget });
        records.push(...got.records);
        budget -= got.fetched;
        if (capped || (budget <= 0 && !got.exhausted)) { truncated = true; break; }
      }
      return { records, truncated };
    }
  };
}

/** Durable archive on Adobe I/O Files: error-monitor/<instance>/<yyyy>/<mm>/<dd>/<id>.json */
function createArchiveStore(files, { instanceId }) {
  if (!INSTANCE_PATTERN.test(instanceId)) throw new Error('invalid instanceId');
  const dir = (day) => `error-monitor/${instanceId}/${day.slice(0, 4)}/${day.slice(4, 6)}/${day.slice(6, 8)}/`;
  const pathFor = (id) => `${dir(id.slice(0, 8))}${id}.json`;

  const store = {
    async write(record) {
      await files.write(pathFor(record.id), JSON.stringify(record));
    },
    async read(id) {
      if (!ID_PATTERN.test(id)) return null;
      try { return parse(await files.read(pathFor(id))); } catch (e) { return null; }
    },
    /** @param {string} date  YYYY-MM-DD (already validated by the caller) */
    async listDay(date, { limit = 25, accept = () => true } = {}) {
      const day = date.replace(/-/g, '');
      let names = [];
      try { names = await files.list(dir(day)); } catch (e) { return { records: [], truncated: false }; }
      const ids = names
        .map((n) => (typeof n === 'string' ? n : n && n.name) || '')
        .map((n) => n.split('/').pop().replace(/\.json$/, ''))
        .filter((id) => ID_PATTERN.test(id) && id.startsWith(day))
        .sort().reverse();
      const got = await collect(ids, (id) => store.read(id), { limit, accept, budget: MAX_FETCH });
      return { records: got.records, truncated: names.length >= FILES_PAGE || (!got.exhausted && got.records.length < limit) };
    }
  };
  return store;
}

module.exports = { createStateStore, createArchiveStore, ymd };
