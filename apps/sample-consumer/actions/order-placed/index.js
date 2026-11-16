'use strict';
const { withErrorMonitor } = require('@commerce-ext/error-monitor-sdk');

const skuList = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Commerce event handler for `observer.sales_order_place_after` (delivered by Adobe I/O Events).
 * Simulates sending the order to an ERP. For demos, an order containing a SKU listed in FAIL_ORDER_SYNC_SKUS
 * makes the ERP call fail; the error is recorded in the Error Monitor and the event delivery is marked failed.
 */
async function orderPlaced(params) {
  const value = (params.data && params.data.value) || {};
  const order = value.order && typeof value.order === 'object' ? value.order : value;
  const items = Array.isArray(order.items) ? order.items : (Array.isArray(value.items) ? value.items : []);
  const skus = items.map((i) => i && i.sku).filter((s) => typeof s === 'string');
  const orderRef = order.increment_id || order.entity_id || 'unknown';

  if (skus.some((s) => skuList(params.FAIL_ORDER_SYNC_SKUS).includes(s))) {
    throw new Error(`ERP rejected order ${orderRef}: Authorization: Bearer ${params.UPSTREAM_TOKEN}`);
  }
  return { statusCode: 200, body: { synced: String(orderRef), items: skus.length } };
}

exports.main = withErrorMonitor(orderPlaced, {
  source: { app: 'sample-consumer', action: 'order-placed', version: '0.1.0', environment: 'stage' }
});
exports.orderPlaced = orderPlaced;
