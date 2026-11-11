'use strict';
const { createStateStore, createArchiveStore } = require('./stores');
const { createEventPublisher } = require('./events');

/** Production wiring. Libraries are required lazily so unit tests never need them installed. */
async function createRealDeps(config) {
  const state = await require('@adobe/aio-lib-state').init();
  const files = config.archiveEnabled ? await require('@adobe/aio-lib-files').init() : null;
  return {
    state: createStateStore(state, { instanceId: config.instanceId, ttl: config.stateTtlSeconds }),
    archive: files ? createArchiveStore(files, { instanceId: config.instanceId }) : null,
    publisher: config.events.enabled ? createEventPublisher(config.events) : null,
    now: Date.now
  };
}

module.exports = { createRealDeps };
