import { expect, it } from 'vitest';
import { attemptFixture } from './bank-card-offer-attempt.test-support';
import { bankCardOfferAttemptMatchesQuote } from './bank-card-offer-attempt-matches-quote';

it('accepts the discounted merchandise plus nonnegative adjustments', () => {
  expect(bankCardOfferAttemptMatchesQuote(attemptFixture)).toBe(true);
  expect(
    bankCardOfferAttemptMatchesQuote({
      ...attemptFixture,
      adjustmentsKobo: 100,
      amountKobo: 9600,
    })
  ).toBe(true);
});

it.each([
  { amountKobo: 9501 },
  { amountKobo: 9499, adjustmentsKobo: -1 },
  { amountKobo: 9500.5, adjustmentsKobo: 0.5 },
  { amountKobo: Number.MAX_SAFE_INTEGER + 1 },
])('rejects invalid payable amounts and adjustments (%j)', (changes) => {
  expect(
    bankCardOfferAttemptMatchesQuote({ ...attemptFixture, ...changes })
  ).toBe(false);
});
