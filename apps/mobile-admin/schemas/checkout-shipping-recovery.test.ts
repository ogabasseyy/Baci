import { describe, expect, it } from 'vitest';
import { checkoutShippingRecoverySchema } from './checkout-shipping-recovery';

describe('checkoutShippingRecoverySchema', () => {
  it('allows a changed price preview without confirmation token', () => {
    expect(
      checkoutShippingRecoverySchema.safeParse({
        previewId: null,
        quote: {
          id: 'q',
          price: 100,
          displayName: 'GIG',
          estimatedDays: 2,
          expiresAt: '2099-01-01',
        },
        paidShippingFee: 90,
        canConfirm: false,
      }).success
    ).toBe(true);
  });
  it('rejects negative prices and missing server fee', () => {
    expect(
      checkoutShippingRecoverySchema.safeParse({
        previewId: 'p',
        quote: { price: -1 },
        canConfirm: true,
      }).success
    ).toBe(false);
  });
});
