import { expect, it } from 'vitest';
import { bankCardOfferClaimSchema } from './bank-card-offer-claim';

it('accepts an expired order retired before provider initialization', () => {
  expect(bankCardOfferClaimSchema.parse({ retired: true })).toEqual({
    retired: true,
  });
});

it('accepts a claimed reference before the checkout URL is saved', () => {
  const claim = {
    claimed: true,
    reference: `BCO-${'a'.repeat(32)}`,
    checkoutUrl: null,
  };
  expect(bankCardOfferClaimSchema.parse(claim)).toEqual(claim);
  expect(
    bankCardOfferClaimSchema.safeParse({ ...claim, reference: 'pending' })
      .success
  ).toBe(false);
  expect(
    bankCardOfferClaimSchema.safeParse({
      ...claim,
      checkoutUrl: 'https://example.com',
    }).success
  ).toBe(false);
});
