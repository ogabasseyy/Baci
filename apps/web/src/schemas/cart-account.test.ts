import { describe, expect, it } from 'vitest';
import {
  cartAccountLinkRequestSchema,
  cartRevokeRequestSchema,
  verifiedCartCustomerRowSchema,
} from './cart-account';

const savedId = '11111111-1111-4111-8111-111111111111';
describe('cart account boundary', () => {
  it('allows explicit keep or saved choices without requiring guest signup fields', () => {
    expect(
      cartAccountLinkRequestSchema.safeParse({
        operationId: 'keep',
        choice: 'keep_current',
      }).success
    ).toBe(true);
    expect(
      cartAccountLinkRequestSchema.safeParse({
        operationId: 'saved',
        choice: 'use_saved',
        expectedSavedCartId: savedId,
      }).success
    ).toBe(true);
  });
  it('requires the complete reviewed merge including both versions and saved identity', () => {
    const merge = {
      operationId: 'merge',
      choice: 'merge',
      expectedSavedCartId: savedId,
      expectedCurrentVersion: 2,
      expectedSavedVersion: 3,
      lines: [],
    };
    expect(cartAccountLinkRequestSchema.safeParse(merge).success).toBe(true);
    for (const key of [
      'expectedSavedCartId',
      'expectedCurrentVersion',
      'expectedSavedVersion',
      'lines',
    ]) {
      expect(
        cartAccountLinkRequestSchema.safeParse({ ...merge, [key]: undefined })
          .success
      ).toBe(false);
    }
  });
  it('rejects caller-injected ownership and malformed verified identities', () => {
    expect(
      cartAccountLinkRequestSchema.safeParse({
        operationId: 'keep',
        choice: 'keep_current',
        userId: savedId,
      }).success
    ).toBe(false);
    expect(
      cartRevokeRequestSchema.safeParse({ merchantId: savedId }).success
    ).toBe(false);
    expect(
      verifiedCartCustomerRowSchema.safeParse({
        id: savedId,
        merchant_id: savedId,
        user_id: 'not-an-id',
      }).success
    ).toBe(false);
  });
});
