import type { BankCardOffer } from '@/schemas/bank-card-offer';

export const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
export const productId = '821516a6-f4b4-427e-83fb-757ed7658082';
export const now = Date.parse('2026-11-27T12:00:00+01:00');
export const offer: BankCardOffer = {
  id: 'wema-launch',
  merchantId,
  bankCode: '035',
  displayName: 'Wema',
  verifiedIssuerName: 'Wema Bank',
  cardBrands: ['visa'],
  eligibleProductIds: [productId],
  discountBasisPoints: 500,
  maximumDiscountKobo: 999,
  startsAt: '2026-11-27T00:00:00+01:00',
  endsAt: '2026-11-28T00:00:00+01:00',
  approvedTermsReference: 'example-approval',
  enabled: true,
};

export const items = [
  { itemId: 'first', productId, unitPriceKobo: 10_000, quantity: 2 },
  {
    itemId: 'second',
    productId: '34b1824d-57c5-4bbf-b297-18c99062a534',
    unitPriceKobo: 2_000,
    quantity: 1,
  },
];
