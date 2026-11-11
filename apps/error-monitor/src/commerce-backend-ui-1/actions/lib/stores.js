'use strict';
const { ID_PATTERN, INSTANCE_PATTERN } = require('@commerce-ext/error-monitor-sdk');

const MAX_SCAN_KEYS = 500;   // per-day key scan cap
const MAX_FETCH = 300;       // total record reads per list request
const DAY_MS = 86400000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

const parse = (v) => {
  try { return typeof v === 'string' ? JSON.parse(v) : (Buffer.isBuffer(v) ? JSON.parse(v.toString('utf8')) : v); } catch (e) { return null; }
};

/**
 * Recent-records store on Adobe I/O State.
 * Key: e.<instance>.<yyyymmdd>.<id>  (id is time-prefixed, so key order == time order).
 * `state` is an initialised @adobe/aio-lib-state client (or a test fake with the same surface).
 */
function createStateStore(state, { instanceId, ttl }) {
  if (!INSTANCE_PATTERN.test(instanceId)) throw new Error('invalid instanceId');
  const prefix = `e.${instanceId}.`;
  const keyFor = (id) => `${prefix}${id.slice(0, 8)}.${id}`;

  async function listKeys(day) {
    const keys = [];
    for await (const page of state.list({ match: `${prefix}${day}.*` })) {
      keys.push(...page.keys);
      if (keys.length >= MAX_SCAN_KEYS) break;
    }
    return keys.slice(0, MAX_SCAN_KEYS);
  }

  return {
    async put(record) {
      await state.put(keyFor(record.id), JSON.stringify(record), { ttl });
    },
    async get(id) {
      if (!ID_PATTERN.test(id)) return null;
      const res = await state.get(keyFor(id));
      return res ? parse(res.value) : null;
    },
    /** Newest-first. `accept(record)` applies caller filters; scanning stops at `limit` matches. */
    async listRecent({ days = 7, limit = 25, now = Date.now(), accept = () => true } = {}) {
      const records = [];
      let fetched = 0;
      let truncated = false;
      for (let i = 0; i < days && records.length < limit; i++) {
        const keys = (await listKeys(ymd(now - i * DAY_MS))).sort().reverse();
        for (const key of keys) {
          if (records.length >= limit) break;
          if (fetched >= MAX_FETCH) { truncated = true; break; }
          fetched += 1;
          const res = await state.get(key);
          const rec = res ? parse(res.value) : null;
          if (rec && accept(rec)) records.push(rec);
        }
        if (truncated) break;
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

  return {
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
      const records = [];
      let fetched = 0;
      for (const id of ids) {
        if (records.length >= limit || fetched >= MAX_FETCH) break;
        fetched += 1;
        const rec = await this.read(id);
        if (rec && accept(rec)) records.push(rec);
      }
      return { records, truncated: ids.length > fetched && records.length < limit };
    }
  };
}

module.exports = { createStateStore, createArchiveStore, ymd };
