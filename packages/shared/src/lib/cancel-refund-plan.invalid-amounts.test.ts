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

  it.each([
    [
      'a negative completed manual row',
      { amount: -20, gateway: 'manual', status: 'completed' },
    ],
    [
      'a zero completed manual row',
      { amount: 0, gateway: 'manual', status: 'completed' },
    ],
    [
      'a NaN completed manual row',
      { amount: Number.NaN, gateway: 'manual', status: 'completed' },
    ],
    [
      'a zero verified Paystack row',
      { amount: 0, provider_refund_status: 'processed', status: 'completed' },
    ],
    [
      'a zero failed row without provider identity',
      { amount: 0, provider_refund_status: 'failed', status: 'failed' },
    ],
    [
      'a zero unlinked row',
      { amount: 0, payment_transaction_id: null, status: 'completed' },
    ],
  ])('is neutral for %s and never sums it', (_name, over) => {
    const result = getCancelRefundPlan({
      amountPaid: 100,
      orderCurrency: 'NGN',
      paymentStatus: 'Paid',
      total: 100,
      transactions: [payment100, pendingRow(over)],
    });
    expect(result.ledgerKnown).toBe(false);
    // 100 capture + a -20 row must not read as 120 owed.
    expect(result.amount).toBeLessThanOrEqual(100);
  });
});
