import { expect, it } from 'vitest';
import { parseOxygenBreakdown } from './runtime-details';

const fee = {
  period: null,
  dueDate: [2026, 10, 20],
  totalInstallmentAmountForPeriod: null,
  principalDue: null,
  interestDue: null,
  totalOriginalDueForPeriod: 5530,
};
const repayment = {
  period: 1,
  dueDate: [2026, 11, 20],
  totalInstallmentAmountForPeriod: 110,
  principalDue: 100,
  interestDue: 10,
  totalOriginalDueForPeriod: 110,
};
it('separates an upfront fee row even when it has a due date', () => {
  expect(parseOxygenBreakdown({ periods: [fee, repayment] }, 1, 100)).toEqual({
    quotedCharges: 5530,
    schedule: [
      {
        period: 1,
        dueDate: [2026, 11, 20],
        amount: 110,
        principal: 100,
        interest: 10,
      },
    ],
  });
});
it('rejects duplicate periods and mismatched principal totals', () => {
  expect(() =>
    parseOxygenBreakdown({ periods: [repayment, repayment] }, 2, 200)
  ).toThrow();
  expect(() =>
    parseOxygenBreakdown({ periods: [repayment] }, 1, 101)
  ).toThrow();
});

const observed = [
  {
    ...repayment,
    period: 35,
    dueDate: [2026, 11, 27],
    totalInstallmentAmountForPeriod: 96474,
    principalDue: 80772.6,
    interestDue: 15701.4,
  },
  {
    ...repayment,
    period: 30,
    dueDate: [2026, 12, 27],
    totalInstallmentAmountForPeriod: 96474,
    principalDue: 85699.73,
    interestDue: 10774.27,
  },
  {
    ...repayment,
    period: 31,
    dueDate: [2027, 1, 27],
    totalInstallmentAmountForPeriod: 96474.26,
    principalDue: 90927.67,
    interestDue: 5546.59,
  },
];
it('normalizes the booked response by due date when period contains day counts, retaining upfront charges', () => {
  const result = parseOxygenBreakdown(
    {
      periods: [
        { ...fee, totalOriginalDueForPeriod: 5083.65 },
        observed[2],
        observed[0],
        observed[1],
      ],
    },
    3,
    257400
  );
  expect(result.quotedCharges).toBe(5083.65);
  expect(result.schedule.map((r) => [r.period, r.dueDate, r.amount])).toEqual([
    [1, [2026, 11, 27], 96474],
    [2, [2026, 12, 27], 96474],
    [3, [2027, 1, 27], 96474.26],
  ]);
});
it('accepts repeated day counts on distinct due dates', () => {
  expect(
    parseOxygenBreakdown(
      { periods: observed.map((r) => ({ ...r, period: 30 })) },
      3,
      257400
    ).schedule
  ).toHaveLength(3);
});
it.each([
  [{ ...observed[0], dueDate: [2026, 2, 30] }, observed[1], observed[2]],
  [observed[0], { ...observed[1], dueDate: observed[0].dueDate }, observed[2]],
  [observed[0], { ...observed[1], principalDue: null }, observed[2]],
  [observed[0], { ...observed[1], interestDue: 1 }, observed[2]],
])('rejects malformed, duplicate-date or inconsistent repayment rows', (...rows) => {
  expect(() => parseOxygenBreakdown({ periods: rows }, 3, 257400)).toThrow();
});
