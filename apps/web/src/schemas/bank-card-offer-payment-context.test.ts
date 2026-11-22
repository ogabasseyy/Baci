import { expect, it } from 'vitest';
import { bankCardOfferPaymentContextSchema } from './bank-card-offer-payment-context';
import { bankCardOfferContextFixture } from './bank-card-offer-payment-context.test-support';

it('accepts a saved quote and rejects a fractional payable amount', () => {
  expect(
    bankCardOfferPaymentContextSchema.parse(bankCardOfferContextFixture)
  ).toEqual(bankCardOfferContextFixture);
  expect(
    bankCardOfferPaymentContextSchema.safeParse({
      ...bankCardOfferContextFixture,
      amountKobo: 9500.5,
    }).success
  ).toBe(false);
});
