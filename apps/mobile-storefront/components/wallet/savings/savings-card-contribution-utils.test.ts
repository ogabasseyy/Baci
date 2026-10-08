import { savingsCardContributionUtils } from './savings-card-contribution-utils';

it('formats the exact card charge with both kobo digits', () => {
  expect(savingsCardContributionUtils.formatAmount(125050)).toBe('₦1,250.50');
});

it.each([
  ['12', 1200],
  ['12.3', 1230],
  ['12.34', 1234],
  ['90071992547409.92', null],
  ['0', null],
  ['1.234', null],
])('converts naira %s to safe integer kobo', (amount, expected) => {
  expect(savingsCardContributionUtils.amountToKobo(amount)).toBe(expected);
});
