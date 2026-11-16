'use strict';
const { createStateStore, createArchiveStore } = require('./stores');
const { createEventPublisher } = require('./events');

// Module scope: warm containers reuse initialised clients (Files init fetches storage credentials).
const clients = {};
function cached(name, init) {
  if (!clients[name]) clients[name] = init().catch((e) => { delete clients[name]; throw e; });
  return clients[name];
}

/** Production wiring. Libraries are required lazily so unit tests never need them installed. */
async function createRealDeps(config) {
  const [state, files] = await Promise.all([
    cached('state', () => require('@adobe/aio-lib-state').init()),
    config.archiveEnabled ? cached('files', () => require('@adobe/aio-lib-files').init()) : null
  ]);
  return {
    state: createStateStore(state, { instanceId: config.instanceId, ttl: config.stateTtlSeconds }),
    archive: files ? createArchiveStore(files, { instanceId: config.instanceId }) : null,
    publisher: config.events.enabled ? createEventPublisher(config.events) : null,
    now: Date.now
  };
}

module.exports = { createRealDeps };
