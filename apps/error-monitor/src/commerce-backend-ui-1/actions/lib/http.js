'use strict';
const BASE_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const respond = (statusCode, body) => ({ statusCode, headers: BASE_HEADERS, body });

/** Structured, secret-free logging. Only ever pass ids, codes and counts - never payload text. */
function log(level, event, fields = {}) {
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ level, event, ...fields }));
}

const lowerKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]));

module.exports = { respond, log, lowerKeys };
