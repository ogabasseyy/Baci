import { expect, it } from 'vitest';
import { createPublicCommerceEvidence } from './public-commerce-evidence';

const origin = 'https://shop.example.com';
const merchantId = '11111111-1111-4111-8111-111111111111';
const productId = '33333333-3333-4333-8333-333333333333';
const cartId = '44444444-4444-4444-8444-444444444444';
const snapshot = {
  cartId,
  merchantId,
  version: 1,
  lines: [{ item: { productId }, quantity: 1 }],
};
const checkoutSnapshot = {
  cartId,
  merchantId,
  cartVersion: 1,
  checkoutSessionId: '55555555-5555-4555-8555-555555555555',
  lines: [{ productId, variantId: null, quantity: 1, available: true }],
};
const add = {
  url: `${origin}/api/storefront/cart/commands`,
  method: 'POST',
  body: JSON.stringify({
    command: { type: 'add', item: { productId }, quantity: 1 },
  }),
};
const read = { url: `${origin}/api/storefront/cart`, method: 'GET' };
const checkout = {
  url: `${origin}/api/storefront/cart/checkout`,
  method: 'POST',
  body: JSON.stringify({ cartId }),
};
const context = `${origin}/products/device`;
const cartReply = { status: 200, body: JSON.stringify({ cart: snapshot }) };
const checkoutReply = {
  status: 200,
  body: JSON.stringify({ snapshot: checkoutSnapshot }),
};
const ledger = () =>
  createPublicCommerceEvidence({
    origin,
    merchantId,
    productId,
    paths: ['/products/device'],
  });

it('records actual add, cart read and checkout review in order without exposing response bodies', () => {
  const record = ledger();
  record.observe(add, cartReply, context);
  record.observe(read, cartReply, context);
  record.observe(checkout, checkoutReply, context);
  const steps = record.complete();
  expect(steps.map((step) => step.action)).toEqual([
    'cart-add',
    'cart-read',
    'checkout-review',
  ]);
  expect(
    steps.every(
      (step) =>
        step.path === '/products/device' &&
        /^[a-f0-9]{64}$/.test(step.evidenceDigest)
    )
  ).toBe(true);
  expect(JSON.stringify(steps)).not.toContain(cartId);
});

it('fails closed on missing steps, out-of-order requests, wrong product, tenant, cart or page', () => {
  const wrong = [
    [
      add,
      {
        status: 200,
        body: JSON.stringify({ cart: { ...snapshot, merchantId: 'other' } }),
      },
      context,
    ],
    [
      add,
      {
        status: 200,
        body: JSON.stringify({
          cart: {
            ...snapshot,
            lines: [{ item: { productId: 'other' }, quantity: 1 }],
          },
        }),
      },
      context,
    ],
    [add, cartReply, `${origin}/unknown`],
  ] as const;
  for (const [request, response, page] of wrong) {
    const record = ledger();
    expect(() => record.observe(request, response, page)).toThrow();
    expect(() => record.complete()).toThrow();
  }
  const order = ledger();
  order.observe(read, cartReply, context);
  expect(() => order.complete()).toThrow();
  const changed = ledger();
  changed.observe(add, cartReply, context);
  changed.observe(read, cartReply, context);
  expect(() =>
    changed.observe(
      checkout,
      {
        status: 200,
        body: JSON.stringify({ snapshot: { ...snapshot, cartId: 'other' } }),
      },
      context
    )
  ).toThrow();
});

it('rejects a wrong add request and checkout without a valid session', () => {
  const wrong = ledger();
  expect(() =>
    wrong.observe(
      {
        ...add,
        body: JSON.stringify({
          command: { type: 'add', item: { productId: 'other' }, quantity: 1 },
        }),
      },
      cartReply,
      context
    )
  ).toThrow();
  const noSession = ledger();
  noSession.observe(add, cartReply, context);
  noSession.observe(read, cartReply, context);
  expect(() =>
    noSession.observe(
      checkout,
      { status: 200, body: JSON.stringify({ snapshot }) },
      context
    )
  ).toThrow();
});
