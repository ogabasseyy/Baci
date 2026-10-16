import { nativeCheckoutSnapshotSchema } from './cart-checkout-snapshot';

const valid = {
  checkoutSessionId: '11111111-1111-4111-8111-111111111111',
  generation: 1,
  cartVersion: 2,
  cartId: '11111111-1111-4111-8111-111111111111',
  merchantId: '11111111-1111-4111-8111-111111111111',
  lines: [],
  estimates: {
    subtotalMinor: 0,
    currency: 'NGN',
    lineCount: 0,
    unavailableCount: 0,
  },
};

describe('nativeCheckoutSnapshotSchema', () => {
  it('accepts an empty reviewed snapshot', () => {
    expect(nativeCheckoutSnapshotSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects lowercase currency and non-positive generations', () => {
    expect(
      nativeCheckoutSnapshotSchema.safeParse({
        ...valid,
        estimates: { ...valid.estimates, currency: 'ngn' },
      }).success
    ).toBe(false);
    expect(
      nativeCheckoutSnapshotSchema.safeParse({ ...valid, generation: 0 })
        .success
    ).toBe(false);
  });

  it('rejects line quantities above the cart maximum', () => {
    const line = {
      id: 'line-1',
      productId: '11111111-1111-4111-8111-111111111111',
      variantId: null,
      condition: null,
      options: {},
      quantity: 11,
      negotiatedUnitPriceMinor: null,
      negotiationStatus: null,
      negotiationInvalidated: false,
      voucherToken: null,
      voucherAwardId: null,
      hasAssurance: false,
      assuranceRate: null,
      lastUnitPriceMinor: null,
      validatedUnitPriceMinor: 0,
      effectiveUnitPriceMinor: 0,
      priceChanged: false,
      available: true,
      unavailableReason: null,
      stockQty: 0,
      manageStock: false,
    };
    expect(
      nativeCheckoutSnapshotSchema.safeParse({ ...valid, lines: [line] })
        .success
    ).toBe(false);
  });
});
