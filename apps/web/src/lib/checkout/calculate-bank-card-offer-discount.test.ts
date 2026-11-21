import { expect, it } from 'vitest';
import { calculateBankCardOfferDiscount } from './calculate-bank-card-offer-discount';

it('rounds half a kobo up and applies the cap', () => {
  expect(calculateBankCardOfferDiscount(10n, 500, 100)).toBe(1n);
  expect(calculateBankCardOfferDiscount(100_000n, 500, 500)).toBe(500n);
});

it.each([
  [-1, 500],
  [10_000, 500],
  [1.25, 500],
  [500, -1],
  [500, 1.25],
  [500, Number.MAX_SAFE_INTEGER + 1],
])('withholds invalid offer terms %s bps with a %s kobo cap', (rate, cap) => {
  expect(calculateBankCardOfferDiscount(10_000n, rate, cap)).toBe(0n);
});
