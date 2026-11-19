'use strict';
const { withWebhookErrorMonitor } = require('@commerce-ext/error-monitor-sdk');

const skuList = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

/** Cart item from the Commerce `observer.sales_quote_add_item` webhook (`data.quote_item`), or a flat item. */
function cartItem(params) {
  const data = params.data && typeof params.data === 'object' ? params.data : params;
  const item = data.quote_item && typeof data.quote_item === 'object' ? data.quote_item : data;
  return typeof item.sku === 'string' ? item : null;
}

/**
 * Example Commerce webhook action (cart validation).
 * Business rule: refuse carts with more than 50 units. Any UNEXPECTED error is recorded in the Error Monitor and
 * Commerce receives a valid `exception` operation with a reference. For demos, adding a SKU listed in
 * FAIL_ADD_TO_CART_SKUS (or simulate=fail) simulates an inventory-service outage.
 */
async function validateCart(params) {
  const item = cartItem(params);
  const failSkus = skuList(params.FAIL_ADD_TO_CART_SKUS);
  if (params.simulate === 'fail' || (item && failSkus.includes(item.sku))) {
    throw new Error(`Inventory service rejected token ${params.UPSTREAM_TOKEN}`);
  }
  const items = Array.isArray(params.cart && params.cart.items) ? params.cart.items : (item ? [item] : []);
  const qty = items.reduce((n, i) => n + (Number(i && i.qty) || 0), 0);
  if (qty > 50) return { statusCode: 200, body: { op: 'exception', message: 'Carts are limited to 50 items.' } };
  return { statusCode: 200, body: { op: 'success' } };
}

exports.main = withWebhookErrorMonitor(validateCart, {
  source: { app: 'sample-consumer', action: 'validate-cart', version: '0.1.0', environment: 'stage' },
  onError: 'exception',
  customerMessage: 'We could not check your cart right now. Please try again.',
  timeoutMs: 3000
});
exports.validateCart = validateCart;
