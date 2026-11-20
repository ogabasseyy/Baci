import type { BankCardOffer } from '@/schemas/bank-card-offer';

export const offerFixture = {
  id: 'black-friday',
  merchantId: '123e4567-e89b-12d3-a456-426614174000',
  bankCode: '035',
  displayName: 'Wema offer',
  verifiedIssuerName: 'Wema Bank',
  cardBrands: ['visa'],
  eligibleProductIds: ['11111111-1111-4111-8111-111111111111'],
  discountBasisPoints: 500,
  maximumDiscountKobo: 5000,
  startsAt: '2025-01-01T00:00:00Z',
  endsAt: '2035-01-01T00:00:00Z',
  approvedTermsReference: 'test-terms',
  enabled: true,
} satisfies BankCardOffer;
