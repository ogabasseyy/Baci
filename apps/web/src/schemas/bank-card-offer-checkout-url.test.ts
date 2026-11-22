import { expect, it } from 'vitest';
import { bankCardOfferCheckoutUrlSchema } from './bank-card-offer-checkout-url';

it('preserves a Paystack URL with query parameters and rejects other origins', () => {
  const url = 'https://checkout.paystack.com/trx/example?state=one%2Btwo&x=1';
  expect(bankCardOfferCheckoutUrlSchema.parse(url)).toBe(url);
  expect(
    bankCardOfferCheckoutUrlSchema.safeParse('https://example.com/trx/test')
      .success
  ).toBe(false);
  expect(
    bankCardOfferCheckoutUrlSchema.safeParse(
      'http://checkout.paystack.com/trx/test'
    ).success
  ).toBe(false);
});
