import { expect, it } from 'vitest';
import { createPaystackCardOfferMetadata } from './create-paystack-card-offer-metadata';

const policy = {
  bankCode: '232',
  cardBrands: ['visa'] as const,
  partnership: 'black-friday',
};

it('preserves a three-digit bank code and checkout partnership', () => {
  expect(createPaystackCardOfferMetadata(policy)).toEqual({
    custom_filters: { banks: ['232'], card_brands: ['visa'] },
    partnership: 'black-friday',
  });
});

it.each([
  { bankCode: '23' },
  { bankCode: 'UBA' },
  { cardBrands: [] },
  { cardBrands: ['visa', 'visa'] },
] as const)('rejects malformed bank codes and empty or duplicate card brands (%j)', (change) => {
  expect(() =>
    createPaystackCardOfferMetadata({
      ...policy,
      ...change,
    })
  ).toThrow('filter is not configured');
});
