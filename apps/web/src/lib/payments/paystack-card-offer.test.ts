import { describe, expect, it } from 'vitest';
import { createPaystackCardOfferMetadata } from './create-paystack-card-offer-metadata';
import { verifyPaystackCardOffer } from './paystack-card-offer';

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
    { bankCode: '2' },
    { cardBrands: [] },
    { cardBrands: ['visa', 'visa'] as const },
  ])('rejects invalid hosted checkout filters %j', (override) => {
    expect(() =>
      createPaystackCardOfferMetadata({ ...policy, ...override })
    ).toThrow('filter');
  });

  it.each([
    { amount: 9501 },
    { currency: 'USD' },
    { reference: 'other-reference' },
    { domain: 'live' },
    { status: 'failed' },
    { channel: 'bank_transfer' },
    {
      authorization: {
        bank: 'Sterling Bank',
        brand: 'visa',
        channel: 'bank_transfer',
      },
    },
    { customer: { email: 'other@example.com' } },
    { paid_at: '2026-11-19T12:00:00' },
  ])('rejects mismatching provider evidence %j', (override) => {
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
            authorization: {
              bank: 'Sterling Bank',
              brand: 'visa',
              channel: 'card',
            },
            id: 42,
            paid_at: '2026-11-19T12:00:00.000Z',
            ...override,
          },
        },
      })
    ).toBeNull();
  });

  it.each([
    ['Sterling Bank', 'visa', true],
    [' sterling bank ', ' VISA ', true],
    ['Wema Bank', 'visa', false],
    ['Sterling Bank PLC', 'visa', false],
    ['', 'visa', false],
    ['Sterling Bank', ' mastercard ', false],
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
