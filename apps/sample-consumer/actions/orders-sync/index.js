'use strict';
const { withErrorMonitor } = require('@commerce-ext/error-monitor-sdk');

/**
 * A deliberately ordinary action. Reuse = one require + one wrapper; no other change to business logic.
 *   simulate=ok           -> succeeds
 *   simulate=fail         -> throws a plain error
 *   simulate=leak         -> throws an error whose message carries a credential and PII, to demonstrate sanitization
 *   simulate=unavailable  -> returns an App Builder-style 503 error response (recorded without throwing)
 */
async function syncOrders(params) {
  if (params.simulate === 'fail') throw new RangeError('Order batch 20260 exceeded the page limit of 100');
  if (params.simulate === 'leak') {
    throw new Error(`Upstream rejected request for ${params.customerEmail || 'customer'}: Authorization: Bearer ${params.UPSTREAM_TOKEN}`);
  }
  if (params.simulate === 'unavailable') return { error: { statusCode: 503, body: { error: 'Order service is unavailable' } } };
  return { statusCode: 200, body: { synced: 3 } };
}

exports.main = withErrorMonitor(syncOrders, {
  source: { app: 'sample-consumer', action: 'orders-sync', version: '0.1.0', environment: 'stage' }
});
exports.syncOrders = syncOrders;
