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

/**
 * Publisher backed by @adobe/aio-lib-events. IMS server-to-server token is fetched with client credentials and cached.
 * `fetchImpl` / `eventsFactory` are injectable for tests.
 */
function createEventPublisher(events, { fetchImpl = globalThis.fetch, eventsFactory, now = Date.now } = {}) {
  let cached = null;

  async function accessToken() {
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
    cached = { token: json.access_token, expiresAt: now() + Number(json.expires_in || 3600) * (json.expires_in > 100000 ? 1 : 1000) };
    return cached.token;
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
