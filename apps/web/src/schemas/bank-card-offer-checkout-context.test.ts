import { expect, it } from 'vitest';
import { bankCardOfferCheckoutContextSchema } from './bank-card-offer-checkout-context';
import { bankCardOfferContextFixture } from './bank-card-offer-payment-context.test-support';

it('requires a Paystack subaccount and a storefront slug', () => {
  const checkout = {
    ...bankCardOfferContextFixture,
    subaccount: 'ACCT_test',
    slug: 'ogabassey',
  };
  expect(bankCardOfferCheckoutContextSchema.parse(checkout)).toEqual(checkout);
  expect(
    bankCardOfferCheckoutContextSchema.safeParse({
      ...checkout,
      slug: 'store.example',
    }).success
  ).toBe(false);
  expect(
    bankCardOfferCheckoutContextSchema.safeParse({
      ...checkout,
      subaccount: '',
    }).success
  ).toBe(false);
});
