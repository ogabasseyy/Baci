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

  const payment100 = { ...payment, currency: 'NGN' };
  const pendingRow = (over: Record<string, unknown>) => ({
    amount: 100,
    currency: 'NGN',
    gateway: 'paystack',
    id: 'refund-x',
    payment_transaction_id: 'pay-1',
    transaction_type: 'refund',
    ...over,
  });

  it('counts a processing refund row as in flight while the payment leg stays completed', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [payment100, pendingRow({ status: 'processing' })],
    });
    expect(plan.amount).toBe(0);
    expect(plan.inFlightAmount).toBe(100);
  });

  it('splits a partly pending refund row from the rest and turns automatic off', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [payment100, pendingRow({ amount: 40, status: 'pending' })],
    });
    expect(plan.amount).toBe(60);
    expect(plan.inFlightAmount).toBe(40);
    expect(plan.automaticSupported).toBe(false);
  });

  it('attributes an unlinked completed refund to the sole payment leg', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [
        payment100,
        pendingRow({ payment_transaction_id: undefined, status: 'completed' }),
      ],
    });
    expect(plan.amount).toBe(0);
  });

  it('leaves an unlinked refund unattributed when several legs could own it', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 200,
      transactions: [
        { ...payment100, id: 'a' },
        { ...payment100, id: 'b' },
        pendingRow({ payment_transaction_id: undefined, status: 'completed' }),
      ],
    });
    expect(plan.amount).toBe(200);
  });

  describe('failed refund rows', () => {
    const failed = (over: Record<string, unknown>) =>
      pendingRow({
        provider_refund_status: 'failed',
        status: 'failed',
        ...over,
      });

    it('keeps a failed row with a numeric provider reference under review, not owed', () => {
      const plan = getCancelRefundPlan({
        paymentStatus: 'Paid',
        total: 100,
        transactions: [payment100, failed({ gateway_reference: '424242' })],
      });
      expect(plan.amount).toBe(0);
      expect(plan.inFlightAmount).toBe(100);
    });

    it('keeps a failed row with a stored provider refund id under review', () => {
      const plan = getCancelRefundPlan({
        paymentStatus: 'Paid',
        total: 100,
        transactions: [payment100, failed({ provider_refund_id: '99' })],
      });
      expect(plan.amount).toBe(0);
      expect(plan.inFlightAmount).toBe(100);
    });

    it('treats a definitive rejection with no provider identity as dead, so the money is still owed', () => {
      const plan = getCancelRefundPlan({
        paymentStatus: 'Paid',
        total: 100,
        transactions: [
          payment100,
          failed({ gateway_reference: 'not-numeric' }),
        ],
      });
      expect(plan.amount).toBe(100);
      expect(plan.inFlightAmount).toBe(0);
    });

    it('keeps a failed row without the failed provider stamp under review like the worker', () => {
      const plan = getCancelRefundPlan({
        paymentStatus: 'Paid',
        total: 100,
        transactions: [
          payment100,
          failed({ provider_refund_status: undefined }),
        ],
      });
      expect(plan.amount).toBe(0);
      expect(plan.inFlightAmount).toBe(100);
    });

    it('ignores an unlinked non-terminal row, as the worker does', () => {
      const plan = getCancelRefundPlan({
        paymentStatus: 'Paid',
        total: 100,
        transactions: [
          payment100,
          pendingRow({
            payment_transaction_id: undefined,
            status: 'processing',
          }),
        ],
      });
      expect(plan.amount).toBe(100);
    });
  });
});
