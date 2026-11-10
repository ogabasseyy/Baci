import { describe, expect, it } from 'vitest';
import { getCancelRefundPlan } from './cancel-refund-plan';
import { payment100, pendingRow } from './cancel-refund-plan.test-support';

const plan = (amount: number, status = 'refund_pending') =>
  getCancelRefundPlan({
    amountPaid: 100,
    orderCurrency: 'NGN',
    paymentStatus: 'Paid',
    total: 100,
    transactions: [payment100, pendingRow({ amount, status })],
  });

describe('getCancelRefundPlan in-flight refund rows with unusable amounts', () => {
  it.each([
    ['zero', 0],
    ['negative', -100],
    ['NaN', Number.NaN],
  ])('is neutral for a %s pending refund and never sums it', (_name, amount) => {
    const result = plan(amount);
    expect(result.ledgerKnown).toBe(false);
    // Not erased (100 owed beside a 0 row) and not reversed (200 owed).
    expect(result.amount).toBeLessThanOrEqual(100);
  });

  it.each([
    'pending',
    'processing',
  ])('is neutral for a zero-amount %s row', (status) => {
    expect(plan(0, status).ledgerKnown).toBe(false);
  });

  it('stays resolved for a positive pending refund', () => {
    const result = plan(100);
    expect(result.ledgerKnown).toBe(true);
    expect(result.inFlightAmount).toBe(100);
  });

  it('ignores a zero-amount row that is provably dead (failed, no identity)', () => {
    const result = getCancelRefundPlan({
      amountPaid: 100,
      orderCurrency: 'NGN',
      paymentStatus: 'Paid',
      total: 100,
      transactions: [
        payment100,
        pendingRow({
          amount: 0,
          provider_refund_status: 'failed',
          status: 'failed',
        }),
      ],
    });
    expect(result.ledgerKnown).toBe(true);
  });
});
