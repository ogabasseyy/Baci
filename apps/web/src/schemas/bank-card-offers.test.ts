import { describe, expect, it } from 'vitest';
import { bankCardOffersSchema } from './bank-card-offers';

const offer = {
  id: 'wema-launch',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  bankCode: '035',
  displayName: 'Wema Bank',
  verifiedIssuerName: 'Wema Bank',
  cardBrands: ['visa'],
  eligibleProductIds: ['821516a6-f4b4-427e-83fb-757ed7658082'],
  discountBasisPoints: 500,
  maximumDiscountKobo: 100_000,
  startsAt: '2026-11-27T00:00:00+01:00',
  endsAt: '2026-11-28T00:00:00+01:00',
  approvedTermsReference: 'test-terms',
  enabled: false,
};

describe('bank card offer inventory', () => {
  it('rejects an offer ID reused for the same merchant', () => {
    expect(bankCardOffersSchema.safeParse([offer, { ...offer }]).success).toBe(
      false
    );
  });

  it('accepts an offer ID reused by a different merchant', () => {
    expect(
      bankCardOffersSchema.safeParse([
        offer,
        { ...offer, merchantId: 'ac261c09-1236-4d21-b8c4-51b68e96d119' },
      ]).success
    ).toBe(true);
  });
});
