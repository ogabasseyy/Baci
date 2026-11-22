import { describe, expect, it } from 'vitest';
import { bankCardOfferSchema } from './bank-card-offer';

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

describe('bank card offer configuration', () => {
  it.each([
    ['035', 'Wema Bank'],
    ['232', 'Sterling Bank'],
  ])('accepts complete terms for %s', (bankCode, verifiedIssuerName) => {
    expect(
      bankCardOfferSchema.safeParse({ ...offer, bankCode, verifiedIssuerName })
        .success
    ).toBe(true);
  });

  it('canonicalizes merchant UUIDs as PostgreSQL does', () => {
    expect(
      bankCardOfferSchema.parse({
        ...offer,
        merchantId: offer.merchantId.toUpperCase(),
      }).merchantId
    ).toBe(offer.merchantId);
  });

  it('accepts offer terms without a storefront display name', () => {
    expect(
      bankCardOfferSchema.safeParse({ ...offer, displayName: undefined })
        .success
    ).toBe(true);
  });

  it.each([1, 9999])('accepts discount bounds %s', (discountBasisPoints) => {
    expect(
      bankCardOfferSchema.safeParse({
        ...offer,
        discountBasisPoints,
        maximumDiscountKobo: Number.MAX_SAFE_INTEGER,
      }).success
    ).toBe(true);
  });

  it.each([
    { id: 'bad id' },
    { id: 'a' },
    { id: 'a'.repeat(65) },
    { merchantId: 'invalid' },
    { bankCode: '232' },
    { displayName: ' ' },
    { eligibleProductIds: ['invalid'] },
    {
      eligibleProductIds: [
        offer.eligibleProductIds[0],
        offer.eligibleProductIds[0].toUpperCase(),
      ],
    },
    { cardBrands: [] },
    { cardBrands: ['unknown'] },
    { startsAt: 'invalid' },
    { endsAt: '2026-11-28T00:00:00' },
    { enabled: 'true' },
    { extra: true },
    { discountBasisPoints: 0 },
    { discountBasisPoints: 1.5 },
    { discountBasisPoints: 10_000 },
    { maximumDiscountKobo: 0 },
    { maximumDiscountKobo: 0.5 },
    { maximumDiscountKobo: Number.MAX_SAFE_INTEGER + 1 },
    { bankCode: '033' },
    { approvedTermsReference: '' },
    { verifiedIssuerName: '' },
    { cardBrands: ['visa', 'visa'] },
    { eligibleProductIds: [] },
    { endsAt: offer.startsAt },
    { discountBasisPoints: 10_001 },
  ])('rejects an unsafe configuration %j', (override) => {
    expect(
      bankCardOfferSchema.safeParse({ ...offer, ...override }).success
    ).toBe(false);
  });
});
