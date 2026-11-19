import { describe, expect, it } from 'vitest';
import {
  createPaystackCardOfferMetadata,
  verifyPaystackCardOffer,
} from './paystack-card-offer';

const policy = {
  partnership: 'sterling-card-offer',
  bankCode: '232',
  issuerName: 'Sterling Bank',
  cardBrands: ['visa'] as const,
};

describe('Paystack bank card offers', () => {
  it('sends the selected bank and card networks to hosted checkout', () => {
    expect(createPaystackCardOfferMetadata(policy)).toEqual({
      partnership: 'sterling-card-offer',
      custom_filters: { banks: ['232'], card_brands: ['visa'] },
    });
  });

  it.each([
    ['Sterling Bank', 'visa', true],
    [' sterling bank ', 'VISA', true],
    ['Wema Bank', 'visa', false],
    ['Sterling Bank', 'mastercard', false],
  ])('verifies %s with %s against the selected offer', (bank, brand, accepted) => {
    expect(
      verifyPaystackCardOffer({
        acceptedFilterPolicyHash: 'a'.repeat(64),
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCustomerEmail: 'buyer@example.com',
        expectedDomain: 'test',
        expectedIssuerName: policy.issuerName,
        expectedReference: 'checkout-reference',
        cardBrands: policy.cardBrands,
        verifyResponse: {
          status: true,
          data: {
            amount: 9500,
            currency: 'NGN',
            customer: { email: 'buyer@example.com' },
            domain: 'test',
            reference: 'checkout-reference',
            status: 'success',
            channel: 'card',
            authorization: { bank, brand, channel: 'card' },
            id: 42,
            paid_at: '2026-11-19T12:00:00.000Z',
          },
        },
      }) !== null
    ).toBe(accepted);
  });
});
