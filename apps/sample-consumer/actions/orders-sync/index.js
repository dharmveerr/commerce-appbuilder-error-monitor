'use strict';
const { withErrorMonitor, createErrorMonitor } = require('@commerce-ext/error-monitor-sdk');

const SOURCE = { app: 'sample-consumer', action: 'orders-sync', version: '0.1.0', environment: 'stage' };
const DEMO_SEVERITY = {
  warning: 'Order service responded slowly (3.2 s)',
  critical: 'Order service is unreachable; orders are not being synced'
};

/**
 * A deliberately ordinary action. Reuse = one require + one wrapper; no other change to business logic.
 *   simulate=ok           -> succeeds
 *   simulate=fail         -> throws a plain error
 *   simulate=leak         -> throws an error whose message carries a credential and PII, to demonstrate sanitization
 *   simulate=unavailable  -> returns an App Builder-style 503 error response (recorded without throwing)
 *   simulate=warning|critical -> records a non-failing finding at that severity and still succeeds (dashboard demo)
 */
async function syncOrders(params) {
  if (DEMO_SEVERITY[params.simulate]) {
    const monitor = createErrorMonitor({ endpoint: params.ERROR_MONITOR_ENDPOINT, signingKey: params.ERROR_MONITOR_SIGNING_KEY, source: SOURCE });
    const result = await monitor.record(new Error(DEMO_SEVERITY[params.simulate]), { severity: params.simulate });
    return { statusCode: 200, body: { synced: 3, recordedSeverity: params.simulate, errorId: result.id } };
  }
  if (params.simulate === 'fail') throw new RangeError('Order batch 20260 exceeded the page limit of 100');
  if (params.simulate === 'leak') {
    throw new Error(`Upstream rejected request for ${params.customerEmail || 'customer'}: Authorization: Bearer ${params.UPSTREAM_TOKEN}`);
  }
  if (params.simulate === 'unavailable') return { error: { statusCode: 503, body: { error: 'Order service is unavailable' } } };
  return { statusCode: 200, body: { synced: 3 } };
}

exports.main = withErrorMonitor(syncOrders, {
  source: SOURCE
});
exports.syncOrders = syncOrders;
