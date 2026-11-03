import { expect, it } from 'vitest';
import { redvaultReconciliationResponseSchema } from './redvault-reconciliation-response';

it('requires the session binding for retirement and an identifiable submitted order', () => {
  expect(
    redvaultReconciliationResponseSchema.safeParse({
      kind: 'retired',
      cartId: 'cart',
      checkoutSessionId: 'session',
      checkoutGeneration: 3,
    }).success
  ).toBe(true);
  expect(
    redvaultReconciliationResponseSchema.safeParse({
      kind: 'retired',
      cartId: 'cart',
    }).success
  ).toBe(false);
  expect(
    redvaultReconciliationResponseSchema.safeParse({
      kind: 'submitted',
      order: { id: 'order-1' },
    }).success
  ).toBe(false);
});
