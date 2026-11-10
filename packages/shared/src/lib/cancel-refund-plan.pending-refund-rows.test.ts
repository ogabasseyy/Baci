import { describe, expect, it } from 'vitest';
import { getCancelRefundPlan } from './cancel-refund-plan';

// A provider-accepted Paystack refund is recorded as its own refund row in
// `refund_pending` while the payment leg stays `completed`. The plan must
// treat that money as already in flight, never as something to repay.
describe('getCancelRefundPlan with linked pending refund rows', () => {
  const payment = {
    amount: 100,
    gateway: 'paystack',
    gateway_reference: 'ref',
    id: 'pay-1',
    status: 'completed',
    transaction_type: 'payment',
  };
  const refundRow = (amount: number) => ({
    amount,
    gateway: 'paystack',
    id: `refund-${amount}`,
    payment_transaction_id: 'pay-1',
    status: 'refund_pending',
    transaction_type: 'refund',
  });

  it('reports a fully accepted refund as in flight with nothing owed', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [payment, refundRow(100)],
    });
    expect(plan.amount).toBe(0);
    expect(plan.inFlightAmount).toBe(100);
  });

  it('leaves only the unaccepted remainder owed', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [payment, refundRow(40)],
    });
    expect(plan.amount).toBe(60);
    expect(plan.inFlightAmount).toBe(40);
  });
});
