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
it('refuses to substitute a stale or foreign product shell for a canonical line', () => {
  expect(() =>
    reviewedCheckoutItems([{ ...cached[0], product_id: 'wrong' }], review)
  ).toThrow();
});
