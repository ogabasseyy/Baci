import { describe, expect, it } from 'vitest';
import {
  cartInputLineSchema,
  cartItemIdentitySchema,
  createCartRequestSchema,
  sharedCartMutationRequestSchema,
} from './cart';

const productId = '11111111-1111-4111-8111-111111111111';
const offerId = '22222222-2222-4222-8222-222222222222';
const variantId = '33333333-3333-4333-8333-333333333333';

describe('exact offer checkout-compatible cart inputs', () => {
  it('rejects a variant paired with an exact offer', () => {
    expect(
      cartItemIdentitySchema.safeParse({ productId, offerId, variantId })
        .success
    ).toBe(false);
  });
  it.each([
    { voucherToken: 'fixture-token' },
    { voucherAwardId: variantId },
    { voucherToken: 'fixture-token', voucherAwardId: variantId },
  ])('rejects offer/voucher attachments at every input boundary: %j', (attachments) => {
    const line = { item: { productId, offerId }, quantity: 1, ...attachments };
    expect(cartInputLineSchema.safeParse(line).success).toBe(false);
    expect(
      createCartRequestSchema.safeParse({
        operationId: 'create-offer',
        lines: [line],
      }).success
    ).toBe(false);
    for (const command of [
      { type: 'add', ...line },
      { type: 'replace', lines: [line] },
    ]) {
      expect(
        sharedCartMutationRequestSchema.safeParse({
          command,
          expectedVersion: 1,
          operationId: 'mutate-offer',
        }).success
      ).toBe(false);
    }
  });
  it('accepts ordinary offers, parent vouchers and variants independently', () => {
    for (const line of [
      { item: { productId, offerId }, quantity: 1 },
      { item: { productId, variantId }, quantity: 1 },
      {
        item: { productId },
        quantity: 1,
        voucherToken: 'fixture-token',
        voucherAwardId: variantId,
      },
    ])
      expect(cartInputLineSchema.safeParse(line).success).toBe(true);
  });
});
