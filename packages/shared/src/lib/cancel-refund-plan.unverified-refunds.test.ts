import { describe, expect, it } from 'vitest';
import { getCancelRefundPlan } from './cancel-refund-plan';
import { payment100, pendingRow } from './cancel-refund-plan.test-support';

describe('getCancelRefundPlan with completed Paystack refund rows without a processed verdict', () => {
  const unverified = (amount: number) =>
    pendingRow({ amount, provider_refund_status: null, status: 'completed' });

  it('treats a full unverified refund as awaiting verification, not covered or owed', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [payment100, unverified(100)],
    });
    expect(plan.amount).toBe(0);
    expect(plan.inFlightAmount).toBe(100);
    expect(plan.automaticSupported).toBe(true);
    expect(plan.ledgerKnown).toBe(true);
  });

  it('does not advise manual repayment of the rest while a partial refund is unverified', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [payment100, unverified(20)],
    });
    expect(plan.amount).toBe(0);
    expect(plan.inFlightAmount).toBe(100);
  });

  it('still counts a processed refund as settled coverage', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [
        payment100,
        pendingRow({ provider_refund_status: 'processed' }),
      ],
    });
    expect(plan.amount).toBe(0);
    expect(plan.inFlightAmount).toBe(0);
  });
});
