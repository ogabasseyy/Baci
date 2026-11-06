import { describe, expect, it } from 'vitest';
import type { StorefrontCheckoutBinding } from './storefront-order-claim-types';
import { validateCheckoutBinding } from './validate-checkout-binding';

const CART_ID = '33333333-3333-4333-8333-333333333333';
const CHECKOUT_SESSION_ID = '44444444-4444-4444-8444-444444444444';
const validCheckoutBinding: StorefrontCheckoutBinding = {
  cartId: CART_ID,
  checkoutSessionId: CHECKOUT_SESSION_ID,
  checkoutGeneration: 4,
  cartVersion: 8,
  identityKind: 'idempotent',
  checkoutVariant: 'base',
  idempotencyKey: 'checkout-idempotency-0001',
  principalId: 'shared-cart-principal-opaque',
  checkoutRequestHash: 'a'.repeat(64),
  deliveryMode: 'merchant_rate',
};

describe('validateCheckoutBinding', () => {
  it('normalizes UUID fields while preserving opaque identity fields', () => {
    expect(
      validateCheckoutBinding({
        ...validCheckoutBinding,
        cartId: CART_ID.toUpperCase(),
        checkoutSessionId: CHECKOUT_SESSION_ID.toUpperCase(),
      })
    ).toEqual({
      version: 1,
      cart_id: CART_ID,
      checkout_session_id: CHECKOUT_SESSION_ID,
      checkout_generation: 4,
      cart_version: 8,
      principal_id: 'shared-cart-principal-opaque',
      delivery_mode: 'merchant_rate',
      identity_kind: 'idempotent',
      checkout_variant: 'base',
      idempotency_key: 'checkout-idempotency-0001',
      checkout_request_hash: 'a'.repeat(64),
    });
  });

  it.each([
    ['invalid cart UUID', { cartId: 'cart-1' }],
    ['invalid session UUID', { checkoutSessionId: 'session-1' }],
    ['zero generation', { checkoutGeneration: 0 }],
    ['fractional cart version', { cartVersion: 1.5 }],
    ['blank principal', { principalId: '  ' }],
    ['short idempotency key', { idempotencyKey: 'too-short' }],
    ['invalid request hash', { checkoutRequestHash: 'a'.repeat(63) }],
    [
      'quiz voucher variant for idempotent identity',
      { checkoutVariant: 'quiz_voucher' },
    ],
  ])('rejects %s', (_case, overrides) => {
    expect(() =>
      validateCheckoutBinding({
        ...validCheckoutBinding,
        ...overrides,
      } as unknown as StorefrontCheckoutBinding)
    ).toThrow();
  });
});
