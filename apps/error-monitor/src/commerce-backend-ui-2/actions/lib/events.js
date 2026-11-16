'use strict';
const { SEVERITY_RANK } = require('@commerce-ext/error-monitor-sdk');

/** CloudEvents 1.0 notification. Deliberately a SUMMARY: no stack, no context - subscribers fetch details via the dashboard. */
function buildCloudEvent(record, events) {
  return {
    specversion: '1.0',
    type: events.eventCode,
    source: `urn:uuid:${events.providerId}`,
    id: record.id,
    time: record.receivedAt,
    datacontenttype: 'application/json',
    data: {
      errorId: record.id,
      fingerprint: record.fingerprint,
      commerceInstanceId: record.commerceInstanceId,
      severity: record.severity,
      app: record.source.app,
      action: record.source.action,
      errorName: record.error.name,
      message: record.error.message.slice(0, 200)
    }
  };
}

const shouldEmit = (record, events) => events.enabled && SEVERITY_RANK[record.severity] >= SEVERITY_RANK[events.minSeverity];

// Module scope: a warm container reuses the token across invocations.
const tokenCache = new Map();

/**
 * Publisher backed by @adobe/aio-lib-events. IMS server-to-server token is fetched with client credentials and cached.
 * `fetchImpl` / `eventsFactory` / `cache` are injectable for tests.
 */
function createEventPublisher(events, { fetchImpl = globalThis.fetch, eventsFactory, now = Date.now, cache = tokenCache } = {}) {
  const cacheKey = `${events.imsTokenUrl}|${events.imsClientId}|${events.imsScopes}`;

  async function accessToken() {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt - 60000 > now()) return cached.token;
    const res = await fetchImpl(events.imsTokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: events.imsClientId, client_secret: events.imsClientSecret, grant_type: 'client_credentials', scope: events.imsScopes }).toString(),
      redirect: 'error'
    });
    if (!res.ok) throw new Error(`ims_token_http_${res.status}`);
    const json = await res.json();
    if (!json.access_token) throw new Error('ims_token_missing');
    const ttlSeconds = Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600; // IMS v3: seconds
    cache.set(cacheKey, { token: json.access_token, expiresAt: now() + ttlSeconds * 1000 });
    return json.access_token;
  }

  return {
    async publish(cloudEvent) {
      const factory = eventsFactory || require('@adobe/aio-lib-events');
      const client = await factory.init(events.imsOrgId, events.imsClientId, await accessToken());
      await client.publishEvent(cloudEvent);
    }
  };
}

module.exports = { buildCloudEvent, shouldEmit, createEventPublisher };
