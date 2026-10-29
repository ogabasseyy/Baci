import { expect, it } from 'vitest';
import { cartCheckoutReconciliationSchema } from './cart-checkout-reconciliation';

const request = {
  cartId: '22222222-2222-4222-8222-222222222222',
  sessionId: '44444444-4444-4444-8444-444444444444',
  generation: 1,
  cartVersion: 2,
  customerEmail: ' Ada@Example.Test ',
  idempotencyKey: 'attempt-key',
};

it('accepts a bound recovery request and normalizes the customer email', () => {
  expect(cartCheckoutReconciliationSchema.parse(request)).toMatchObject({
    customerEmail: 'ada@example.test',
  });
});

it('rejects an unbound or malformed recovery request', () => {
  expect(
    cartCheckoutReconciliationSchema.safeParse({ ...request, cartId: 'bad' })
      .success
  ).toBe(false);
  expect(
    cartCheckoutReconciliationSchema.safeParse({ ...request, generation: 0 })
      .success
  ).toBe(false);
  expect(
    cartCheckoutReconciliationSchema.safeParse({
      ...request,
      idempotencyKey: '',
    }).success
  ).toBe(false);
  expect(
    cartCheckoutReconciliationSchema.safeParse({
      ...request,
      userId: 'caller-selected',
    }).success
  ).toBe(false);
});
