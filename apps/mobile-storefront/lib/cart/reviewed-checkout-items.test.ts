import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';
import type { CartItem } from '@/stores/cart-store.types';
import { reviewedCheckoutItems } from './reviewed-checkout-items';

const cached = [
  {
    id: 'line',
    product_id: 'product',
    name: 'Phone',
    slug: 'phone',
    quantity: 3,
    price: 100,
    negotiatedPrice: 80,
    negotiationStatus: 'accepted',
    hasAssurance: true,
  },
  {
    id: 'removed',
    product_id: 'other',
    name: 'Charger',
    quantity: 1,
    price: 10,
  },
] as CartItem[];
const review: NativeCheckoutSnapshot = {
  checkoutSessionId: '00000000-0000-4000-8000-000000000001',
  generation: 1,
  cartVersion: 1,
  cartId: '00000000-0000-4000-8000-000000000002',
  merchantId: '00000000-0000-4000-8000-000000000003',
  estimates: {
    subtotalMinor: 24000,
    currency: 'NGN',
    lineCount: 1,
    unavailableCount: 0,
  },
  lines: [
    {
      id: 'line',
      productId: 'product',
      variantId: null,
      condition: 'new',
      options: { color: 'Blue' },
      quantity: 2,
      validatedUnitPriceMinor: 12000,
      effectiveUnitPriceMinor: 12000,
      negotiatedUnitPriceMinor: 8000,
      negotiationStatus: 'accepted',
      negotiationInvalidated: true,
      voucherToken: null,
      voucherAwardId: null,
      hasAssurance: true,
      assuranceRate: null,
      lastUnitPriceMinor: 10000,
      priceChanged: true,
      available: true,
      unavailableReason: null,
      stockQty: 10,
      manageStock: true,
    },
  ],
};
it('uses the reviewed remaining lines, quantity and price while discarding invalid negotiation prices', () => {
  expect(reviewedCheckoutItems(cached, review)).toEqual([
    expect.objectContaining({
      id: 'line',
      quantity: 2,
      price: 120,
      negotiatedPrice: undefined,
      hasAssurance: true,
      variant_attributes: { color: 'Blue' },
    }),
  ]);
});
it('replaces a stale cached offer with the reviewed offer id', () => {
  const offerId = '55555555-5555-4555-8555-555555555555';
  const stale = reviewedCheckoutItems(
    [{ ...cached[0], offer_id: '44444444-4444-4444-8444-444444444444' }],
    review
  );
  expect(stale[0]?.offer_id).toBeUndefined();
  const exact = reviewedCheckoutItems(cached, {
    ...review,
    lines: [{ ...review.lines[0], offerId }],
  });
  expect(exact[0]?.offer_id).toBe(offerId);
});
it('refuses to substitute a stale or foreign product shell for a canonical line', () => {
  expect(() =>
    reviewedCheckoutItems([{ ...cached[0], product_id: 'wrong' }], review)
  ).toThrow();
});

it('keeps reviewed voucher prizes free despite a positive catalog price', () => {
  const prize = {
    ...review,
    lines: [
      { ...review.lines[0], voucherToken: 'prize', voucherAwardId: 'award' },
    ],
  };
  expect(reviewedCheckoutItems(cached, prize)[0].price).toBe(0);
  expect(
    reviewedCheckoutItems(cached, prize)[0].negotiatedPrice
  ).toBeUndefined();
});

it.each([
  ['prize', null],
  [null, 'award'],
] as const)('prices partial voucher credentials %s/%s from the reviewed catalog price', (voucherToken, voucherAwardId) => {
  const partial = {
    ...review,
    lines: [{ ...review.lines[0], voucherToken, voucherAwardId }],
  };
  expect(reviewedCheckoutItems(cached, partial)[0]).toMatchObject({
    price: 120,
    quantity: 2,
    negotiatedPrice: undefined,
  });
});

it.each([
  ['prize', null],
  [null, 'award'],
] as const)('does not let partial voucher credentials suppress a valid reviewed negotiation', (voucherToken, voucherAwardId) => {
  const negotiated = {
    ...review,
    lines: [
      {
        ...review.lines[0],
        voucherToken,
        voucherAwardId,
        negotiationInvalidated: false,
        effectiveUnitPriceMinor: 8000,
      },
    ],
  };
  expect(reviewedCheckoutItems(cached, negotiated)[0]).toMatchObject({
    price: 120,
    negotiatedPrice: 80,
    negotiationStatus: 'accepted',
    quantity: 2,
  });
});

it.each([
  ['prize', null],
  [null, 'award'],
] as const)('clears both submitted voucher fields for partial canonical pairs %s/%s without mutating cached metadata', (voucherToken, voucherAwardId) => {
  const cachedWithOldVoucher = cached.map((item) => ({
    ...item,
    voucher_token: 'old-token',
    voucher_award_id: 'old-award',
  }));
  const partial = {
    ...review,
    lines: [{ ...review.lines[0], voucherToken, voucherAwardId }],
  };
  const [item] = reviewedCheckoutItems(cachedWithOldVoucher, partial);
  expect(item.voucher_token).toBeUndefined();
  expect(item.voucher_award_id).toBeUndefined();
  expect(cachedWithOldVoucher[0]).toMatchObject({
    voucher_token: 'old-token',
    voucher_award_id: 'old-award',
  });
  expect(partial.lines[0]).toMatchObject({ voucherToken, voucherAwardId });
});
