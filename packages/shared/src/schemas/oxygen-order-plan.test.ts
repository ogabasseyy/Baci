import { describe, expect, it } from 'vitest';
import {
  formatOxygenPaymentDate,
  formatOxygenRepaymentReceiptDate,
  OXYGEN_REPAYMENT_HISTORY_LIMIT,
  oxygenOrderPlanResponseSchema,
  oxygenOrderPlanSchema,
  oxygenRepaymentReceiptsSchema,
} from './oxygen-order-plan';

const receipt = {
  id: 'bb3955b1-0571-49eb-919f-6a6946fdb00b',
  recordedAt: '2026-11-19T23:30:00Z',
};
const instalment = { period: 1, dueDate: [2026, 1, 31], amount: 0 };
it('bounds repayment history at the disclosed maximum', () => {
  const entries = Array.from(
    { length: OXYGEN_REPAYMENT_HISTORY_LIMIT },
    () => receipt
  );
  expect(oxygenRepaymentReceiptsSchema.safeParse(entries).success).toBe(true);
  expect(
    oxygenRepaymentReceiptsSchema.safeParse([...entries, receipt]).success
  ).toBe(false);
});
const plan = {
  upfront: null,
  upfrontConfirmed: false,
  months: 1,
  schedule: [instalment],
};

describe('Oxygen order plan response', () => {
  it('accepts an absent plan and a plan saved before acknowledgements', () => {
    expect(oxygenOrderPlanResponseSchema.parse({ plan: null })).toEqual({
      plan: null,
    });
    expect(oxygenOrderPlanResponseSchema.parse({ plan }).plan).toEqual({
      ...plan,
      activationConfirmed: false,
    });
  });

  it('accepts and strips a receipt to its allowlisted fields', () => {
    expect(
      oxygenRepaymentReceiptsSchema.parse([{ ...receipt, providerId: 'x' }])
    ).toEqual([receipt]);
  });

  it.each([
    { ...receipt, id: 'not-a-uuid' },
    { ...receipt, recordedAt: '2026-11-19T23:30:00' },
    { ...receipt, recordedAt: 'not-a-date' },
    { ...receipt, recordedAt: undefined },
  ])('rejects an invalid receipt %#', (invalid) => {
    expect(oxygenRepaymentReceiptsSchema.safeParse([invalid]).success).toBe(
      false
    );
  });

  it.each([
    { upfront: -1 },
    { upfront: Number.POSITIVE_INFINITY },
    { upfrontConfirmed: 1 },
    { activationConfirmed: 'true' },
    { months: 0 },
    { months: 1.5 },
    { months: 13 },
    {
      months: 12,
      schedule: Array.from({ length: 13 }, (_, index) => ({
        ...instalment,
        period: index + 1,
      })),
    },
    { schedule: [{ ...instalment, period: 0 }] },
    { schedule: [{ ...instalment, amount: -1 }] },
    { schedule: [{ ...instalment, amount: Number.POSITIVE_INFINITY }] },
    { schedule: [{ ...instalment, dueDate: [2026.5, 1, 31] }] },
    { schedule: [{ ...instalment, dueDate: [2026, 0, 31] }] },
    { schedule: [{ ...instalment, dueDate: [2026, 13, 31] }] },
    { schedule: [{ ...instalment, dueDate: [2026, 12, 0] }] },
    { schedule: [{ ...instalment, dueDate: [2026, 12, 32] }] },
    { schedule: [{ ...instalment, dueDate: [2026, 2, 30] }] },
    { schedule: [{ ...instalment, dueDate: [2026, 2, 29] }] },
    { schedule: [{ ...instalment, dueDate: [2026, 4, 31] }] },
    { schedule: [{ ...instalment, dueDate: [0, 1, 1] }] },
    { schedule: [{ ...instalment, dueDate: [10000, 1, 1] }] },
    { schedule: [instalment, { ...instalment, amount: 1 }] },
    { scheduleIncomplete: 'true' },
  ])('rejects an invalid plan %#', (patch) => {
    expect(oxygenOrderPlanSchema.safeParse({ ...plan, ...patch }).success).toBe(
      false
    );
  });

  it('accepts a leap day in a leap year', () => {
    const schedule = [{ ...instalment, dueDate: [2028, 2, 29] }];
    expect(oxygenOrderPlanSchema.parse({ ...plan, schedule }).schedule).toEqual(
      schedule
    );
  });
});

it('keeps calendar dates and converts recorded instants to Lagos time', () => {
  expect(formatOxygenPaymentDate([2026, 1, 1])).toBe('1 Jan 2026');
  expect(formatOxygenPaymentDate([2026, 12, 31])).toBe('31 Dec 2026');
  expect(formatOxygenRepaymentReceiptDate(receipt.recordedAt)).toBe(
    '20 Nov 2026'
  );
  expect(formatOxygenRepaymentReceiptDate('2026-11-20T00:15:00+01:00')).toBe(
    '20 Nov 2026'
  );
});
