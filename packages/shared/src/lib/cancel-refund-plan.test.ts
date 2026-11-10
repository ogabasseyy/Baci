import { describe, expect, it } from 'vitest';
import { getCancelRefundPlan, isPaidStatus } from './cancel-refund-plan';
import { leg } from './cancel-refund-plan.test-support';

const getAutomaticCancelRefundAmount = (
  order: Parameters<typeof getCancelRefundPlan>[0]
) => getCancelRefundPlan(order).amount;

describe('getAutomaticCancelRefundAmount', () => {
  it('sums completed external payment legs', () => {
    expect(
      getAutomaticCancelRefundAmount({
        paymentStatus: 'Paid',
        total: 8000,
        transactions: [leg(), leg({ amount: 3000, gateway: ' Paystack ' })],
      })
    ).toBe(8000);
  });

  it('tracks refund_pending legs as in flight, not as new refunds', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 10000,
      transactions: [
        leg({ id: 'a', status: 'refund_pending' }),
        leg({ id: 'b', status: 'refunded' }),
      ],
    });
    expect(plan.amount).toBe(0);
    expect(plan.inFlightAmount).toBe(5000);
  });

  it('plans only the non-in-flight leg when both are present', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 10000,
      transactions: [
        leg({ id: 'a', status: 'refund_pending' }),
        leg({ id: 'b' }),
      ],
    });
    expect(plan).toEqual({
      amount: 5000,
      automaticSupported: true,
      inFlightAmount: 5000,
      ledgerKnown: true,
    });
  });

  it('computes coverage in integer minor units', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 0.8,
      transactions: [
        leg({ amount: 0.8, currency: 'NGN' }),
        {
          amount: 0.1,
          currency: 'NGN',
          gateway: 'paystack',
          payment_transaction_id: 'leg-1',
          provider_refund_status: 'processed',
          status: 'completed',
          transaction_type: 'refund',
        },
        {
          amount: 0.7,
          currency: 'NGN',
          gateway: 'paystack',
          payment_transaction_id: 'leg-1',
          provider_refund_status: 'processed',
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
    });
    expect(plan.amount).toBe(0);
  });

  it('excludes legs already covered by a completed refund row', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 10000,
      transactions: [
        leg({ id: 'a' }),
        leg({ id: 'b' }),
        {
          amount: 5000,
          currency: 'NGN',
          gateway: 'paystack',
          payment_transaction_id: 'a',
          provider_refund_status: 'processed',
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
    });
    expect(plan).toEqual({
      amount: 5000,
      automaticSupported: true,
      inFlightAmount: 0,
      ledgerKnown: true,
    });
  });

  it('turns automatic refunds off when an outstanding leg is not Paystack', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 8000,
      transactions: [leg({ id: 'a' }), leg({ id: 'b', gateway: 'korapay' })],
    });
    expect(plan).toEqual({
      amount: 10000,
      automaticSupported: false,
      inFlightAmount: 0,
      ledgerKnown: true,
    });
  });

  it('keeps automatic refunds when only a covered leg is non-Paystack', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 8000,
      transactions: [
        leg({ id: 'a' }),
        leg({ id: 'b', gateway: 'korapay' }),
        {
          amount: 5000,
          currency: 'NGN',
          gateway: 'korapay',
          payment_transaction_id: 'b',
          provider_refund_status: 'processed',
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
    });
    expect(plan).toEqual({
      amount: 5000,
      automaticSupported: true,
      inFlightAmount: 0,
      ledgerKnown: true,
    });
  });

  it('ignores internal, pending, and refund legs', () => {
    expect(
      getAutomaticCancelRefundAmount({
        paymentStatus: 'Paid',
        total: 9000,
        transactions: [
          leg({ gateway: 'wallet' }),
          leg({ gateway: 'STORE_CREDIT' }),
          leg({ status: 'pending' }),
          leg({ transaction_type: 'refund' }),
        ],
      })
    ).toBe(0);
  });

  it('reads the paid status case-insensitively when the ledger is unknown', () => {
    expect(
      getCancelRefundPlan({ paymentStatus: 'PAID', total: 4000 }).amount
    ).toBe(4000);
    expect(
      getCancelRefundPlan({ paymentStatus: 'unpaid', total: 4000 }).amount
    ).toBe(0);
  });

  it('falls back to the total for a paid order with unknown ledger', () => {
    expect(
      getAutomaticCancelRefundAmount({ paymentStatus: 'Paid', total: 4000 })
    ).toBe(4000);
    expect(
      getAutomaticCancelRefundAmount({ paymentStatus: 'Pending', total: 4000 })
    ).toBe(0);
  });

  it('keeps a partially refunded leg outstanding but not automatic', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [
        leg({ amount: 100, currency: 'NGN' }),
        {
          amount: 20,
          currency: 'NGN',
          gateway: 'paystack',
          payment_transaction_id: 'leg-1',
          provider_refund_status: 'processed',
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
    });
    // Verified partial coverage is a mismatch the worker withholds and
    // quarantines: no automatic option and no repay advice (unresolved).
    expect(plan).toEqual({
      amount: 80,
      automaticSupported: false,
      inFlightAmount: 0,
      ledgerKnown: false,
    });
  });

  it('ignores refunds in another currency when judging coverage', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [
        leg({ amount: 100, currency: 'NGN' }),
        {
          amount: 100,
          currency: 'USD',
          gateway: 'paystack',
          payment_transaction_id: 'leg-1',
          provider_refund_status: 'processed',
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
    });
    expect(plan.amount).toBe(100);
  });

  it('flags a plan built without a ledger as unknown', () => {
    expect(
      getCancelRefundPlan({ paymentStatus: 'Paid', total: 4000 }).ledgerKnown
    ).toBe(false);
  });

  it('recognizes case-variant paid statuses only', () => {
    expect(isPaidStatus('paid')).toBe(true);
    expect(isPaidStatus(' PAID ')).toBe(true);
    expect(isPaidStatus('Paid')).toBe(true);
    expect(isPaidStatus('unpaid')).toBe(false);
    expect(isPaidStatus(undefined)).toBe(false);
  });
});
