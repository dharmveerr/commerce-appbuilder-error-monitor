#!/usr/bin/env node
'use strict';
/**
 * Real storefront flow against an ACCS instance (guest checkout via GraphQL), used to demo the Error Monitor:
 *   1. add a normal SKU            -> sample webhook allows it
 *   2. add FAIL_CART_SKU           -> sample webhook fails, shopper gets "... (reference <id>)", error recorded
 *   3. add FAIL_ORDER_SKU, check out and place the order
 *                                  -> order event reaches sample-consumer/order-placed, ERP call fails, error recorded
 *
 * Env: COMMERCE_GRAPHQL_ENDPOINT (required), NORMAL_SKU, FAIL_CART_SKU, FAIL_ORDER_SKU, STORE_CODE (default "default").
 * Usage: COMMERCE_GRAPHQL_ENDPOINT=https://<host>/<tenant>/graphql node scripts/commerce-flow.js [cart|order|all]
 */
const E = process.env;
const endpoint = E.COMMERCE_GRAPHQL_ENDPOINT;
if (!endpoint) { console.error('Set COMMERCE_GRAPHQL_ENDPOINT'); process.exit(2); }
const NORMAL_SKU = E.NORMAL_SKU || 'ACM-3030';
const FAIL_CART_SKU = E.FAIL_CART_SKU || 'AGV-3939';
const FAIL_ORDER_SKU = E.FAIL_ORDER_SKU || 'BPG-5005';
const mode = process.argv[2] || 'all';

async function gql(query, variables = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Store: E.STORE_CODE || 'default' },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data, errors: json.errors || [] };
}

const errorText = (r) => r.errors.map((e) => e.message).join(' | ');

async function addToCart(cartId, sku) {
  const r = await gql(`mutation($cartId: String!, $sku: String!) {
    addProductsToCart(cartId: $cartId, cartItems: [{ sku: $sku, quantity: 1 }]) {
      cart { total_quantity }
      user_errors { code message }
    } }`, { cartId, sku });
  const out = r.data && r.data.addProductsToCart;
  const userErrors = out ? out.user_errors.map((e) => e.message) : [];
  return { ok: !r.errors.length && !userErrors.length, message: errorText(r) || userErrors.join(' | '), cart: out && out.cart };
}

async function placeOrder(cartId) {
  const address = {
    firstname: 'Demo', lastname: 'Shopper', street: ['1 Demo Street'], city: 'Austin', region: 'TX',
    postcode: '78701', country_code: 'US', telephone: '5125550100', save_in_address_book: false
  };
  const steps = [
    ['email', `mutation($cartId: String!) { setGuestEmailOnCart(input: { cart_id: $cartId, email: "demo.shopper@example.com" }) { cart { email } } }`],
    ['shipping address', `mutation($cartId: String!, $a: CartAddressInput!) { setShippingAddressesOnCart(input: { cart_id: $cartId, shipping_addresses: [{ address: $a }] }) {
      cart { shipping_addresses { available_shipping_methods { carrier_code method_code available } } } } }`],
    ['billing address', `mutation($cartId: String!, $a: CartAddressInput!) { setBillingAddressOnCart(input: { cart_id: $cartId, billing_address: { address: $a } }) { cart { id } } }`]
  ];
  let shipping = null;
  for (const [name, q] of steps) {
    const r = await gql(q, { cartId, a: address });
    if (r.errors.length) throw new Error(`${name}: ${errorText(r)}`);
    if (name === 'shipping address') {
      const methods = r.data.setShippingAddressesOnCart.cart.shipping_addresses[0].available_shipping_methods.filter((m) => m.available);
      shipping = methods.find((m) => m.carrier_code === 'flatrate') || methods[0];
      if (!shipping) throw new Error('no shipping method available');
    }
  }
  let r = await gql(`mutation($cartId: String!, $c: String!, $m: String!) { setShippingMethodsOnCart(input: { cart_id: $cartId, shipping_methods: [{ carrier_code: $c, method_code: $m }] }) {
    cart { available_payment_methods { code } } } }`, { cartId, c: shipping.carrier_code, m: shipping.method_code });
  if (r.errors.length) throw new Error(`shipping method: ${errorText(r)}`);
  const payments = r.data.setShippingMethodsOnCart.cart.available_payment_methods.map((p) => p.code);
  const payment = payments.includes('checkmo') ? 'checkmo' : payments[0];
  if (!payment) throw new Error('no payment method available');
  r = await gql(`mutation($cartId: String!, $p: String!) { setPaymentMethodOnCart(input: { cart_id: $cartId, payment_method: { code: $p } }) { cart { id } } }`, { cartId, p: payment });
  if (r.errors.length) throw new Error(`payment method: ${errorText(r)}`);
  r = await gql(`mutation($cartId: String!) { placeOrder(input: { cart_id: $cartId }) { orderV2 { number } errors { message code } } }`, { cartId });
  const po = r.data && r.data.placeOrder;
  if (r.errors.length || (po && po.errors && po.errors.length)) throw new Error(`place order: ${errorText(r) || po.errors.map((e) => e.message).join(' | ')}`);
  return { number: po.orderV2.number, shipping: `${shipping.carrier_code}_${shipping.method_code}`, payment };
}

(async () => {
  const created = await gql('mutation { createGuestCart { cart { id } } }');
  if (created.errors.length) throw new Error(`create cart: ${errorText(created)}`);
  const cartId = created.data.createGuestCart.cart.id;
  console.log('Guest cart created');

  const normal = await addToCart(cartId, NORMAL_SKU);
  console.log(`${normal.ok ? 'PASS' : 'FAIL'}  add ${NORMAL_SKU} (normal product)${normal.ok ? '' : `: ${normal.message}`}`);

  if (mode === 'cart' || mode === 'all') {
    const failing = await addToCart(cartId, FAIL_CART_SKU);
    const hasRef = /\(reference \d{17}-[0-9a-f]{8}\)/.test(failing.message);
    console.log(`${!failing.ok && hasRef ? 'PASS' : 'CHECK'}  add ${FAIL_CART_SKU} (webhook failure) -> shopper sees: "${failing.message || 'added without error'}"`);
  }

  if (mode === 'order' || mode === 'all') {
    const orderItem = await addToCart(cartId, FAIL_ORDER_SKU);
    console.log(`${orderItem.ok ? 'PASS' : 'FAIL'}  add ${FAIL_ORDER_SKU} (order-sync failure trigger)${orderItem.ok ? '' : `: ${orderItem.message}`}`);
    const order = await placeOrder(cartId);
    console.log(`PASS  order ${order.number} placed (${order.shipping}, ${order.payment}). The order event is delivered asynchronously; check the dashboard in ~30 s.`);
  }
})().catch((e) => { console.error('Flow stopped:', e.message); process.exit(1); });
