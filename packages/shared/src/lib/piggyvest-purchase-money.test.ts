import { expect, it } from 'vitest';
import { formatPiggyvestPurchaseMoney } from './piggyvest-purchase-money';

it('preserves exact kobo including the safe integer boundary', () => {
  expect(formatPiggyvestPurchaseMoney(50)).toBe('₦0.50');
  expect(formatPiggyvestPurchaseMoney(104750)).toBe('₦1,047.50');
  expect(formatPiggyvestPurchaseMoney(Number.MAX_SAFE_INTEGER)).toBe(
    '₦90,071,992,547,409.91'
  );
});
it('rejects invalid or non-integral amounts', () => {
  for (const amount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => formatPiggyvestPurchaseMoney(amount)).toThrow();
});
