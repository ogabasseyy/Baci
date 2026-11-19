import { expect, it } from 'vitest';
import { oxygenLoanBreakdownSchema } from './oxygen-loan-breakdown';

const row = {
  period: 35,
  dueDate: [2026, 11, 27],
  totalInstallmentAmountForPeriod: 110,
  principalDue: 100,
  interestDue: 10,
};
it('accepts provider day counts and a separate nullable upfront charge row', () => {
  expect(
    oxygenLoanBreakdownSchema.safeParse({
      periods: [
        row,
        {
          period: null,
          dueDate: null,
          totalInstallmentAmountForPeriod: null,
          principalDue: null,
          interestDue: null,
          totalOriginalDueForPeriod: 5083.65,
        },
      ],
    }).success
  ).toBe(true);
});
it.each([
  -1,
  1.001,
  Number.POSITIVE_INFINITY,
])('rejects invalid provider money %s', (amount) => {
  expect(
    oxygenLoanBreakdownSchema.safeParse({
      periods: [{ ...row, principalDue: amount }],
    }).success
  ).toBe(false);
});
