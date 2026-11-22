import { describe, expect, it } from 'vitest';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { previewBankCardOffer } from './preview-bank-card-offer';

const offer = {
  id: 'fixture',
  verifiedIssuerName: 'Fixture Bank',
  eligibleProductIds: ['phone'],
  cardBrands: ['visa' as const],
  discountBasisPoints: 500,
  maximumDiscountKobo: 4000,
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2026-12-01T00:00:00Z',
};
const now = Date.parse(offer.startsAt);
const items = buildCheckoutOrderItems([
  {
    id: 'PHONE',
    name: 'Phone',
    price: 500,
    quantity: 2,
    hasAssurance: true,
    assuranceRate: 0.01,
  },
  { id: 'cable', name: 'Cable', price: 100, quantity: 1 },
]);

describe('previewBankCardOffer', () => {
  it('caps savings on eligible products only and includes fees in the payable amount', () => {
    expect(previewBankCardOffer(offer, items, [20, 5, 2], now)).toEqual({
      id: 'fixture',
      discountKobo: 4000,
      payableKobo: 109700,
    });
  });

  it('hides unavailable, expired, or incompatible quotes', () => {
    expect(previewBankCardOffer(offer, items, [], now - 1)).toBeNull();
    expect(
      previewBankCardOffer(offer, items, [], Date.parse(offer.endsAt))
    ).toBeNull();
    expect(previewBankCardOffer(offer, items.slice(1), [], now)).toBeNull();
    expect(previewBankCardOffer(offer, items, [0.001], now)).toBeNull();
    expect(
      previewBankCardOffer(
        offer,
        [{ ...items[0], voucher_token: 'voucher' }],
        [],
        now
      )
    ).toBeNull();
  });
});
