import { expect, it } from 'vitest';
import { calculateBankCardOfferDiscount } from './calculate-bank-card-offer-discount';

it('rounds half a kobo up and applies the cap', () => {
  expect(calculateBankCardOfferDiscount(10n, 500, 100)).toBe(1n);
  expect(calculateBankCardOfferDiscount(100_000n, 500, 500)).toBe(500n);
});
