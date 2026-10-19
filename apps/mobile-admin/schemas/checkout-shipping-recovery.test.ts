import { describe, expect, it } from 'vitest';
import {
  checkoutShippingRecoveryConfirmationSchema,
  checkoutShippingRecoveryErrorSchema,
  checkoutShippingRecoverySchema,
} from './checkout-shipping-recovery';

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

describe('checkoutShippingRecoveryConfirmationSchema', () => {
  it('preserves string quote IDs and strips unrelated fields', () => {
    expect(
      checkoutShippingRecoveryConfirmationSchema.parse({
        quoteId: 'q',
        confirmed: true,
        internal: 'hidden',
      })
    ).toEqual({ quoteId: 'q', confirmed: true });
  });

  it.each([
    null,
    {},
    { quoteId: undefined, confirmed: true },
    { quoteId: 123, confirmed: true },
    { quoteId: 'q', confirmed: false },
    { quoteId: 'q', confirmed: 'true' },
    { quoteId: 'q' },
  ])('rejects invalid confirmation %j', (payload) => {
    expect(
      checkoutShippingRecoveryConfirmationSchema.safeParse(payload).success
    ).toBe(false);
  });
});

describe('checkoutShippingRecoveryErrorSchema', () => {
  it('parses the server error and strips unrelated fields', () => {
    expect(
      checkoutShippingRecoveryErrorSchema.parse({
        error: 'Not authorized',
        internal: 'hidden',
      })
    ).toEqual({ error: 'Not authorized' });
  });

  it.each([
    null,
    {},
    { error: 123 },
    { error: null },
  ])('rejects invalid error payload %j', (payload) => {
    expect(checkoutShippingRecoveryErrorSchema.safeParse(payload).success).toBe(
      false
    );
  });
});
