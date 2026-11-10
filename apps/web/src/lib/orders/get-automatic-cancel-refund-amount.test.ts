import { describe, expect, it } from 'vitest';
import {
  getAutomaticCancelRefundAmount,
  getCancelRefundPlan,
} from './get-automatic-cancel-refund-amount';

const leg = (over: Record<string, unknown> = {}) => ({
  amount: 5000,
  gateway: 'paystack',
  gateway_reference: 'ref',
  id: 'leg-1',
  status: 'completed',
  transaction_type: 'payment',
  ...over,
});

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

  it('counts refund_pending legs but not self-terminal refunded ones', () => {
    expect(
      getAutomaticCancelRefundAmount({
        paymentStatus: 'Paid',
        total: 10000,
        transactions: [
          leg({ id: 'a', status: 'refund_pending' }),
          leg({ id: 'b', status: 'refunded' }),
        ],
      })
    ).toBe(5000);
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
          gateway: 'paystack',
          payment_transaction_id: 'a',
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
    });
    expect(plan).toEqual({ amount: 5000, automaticSupported: true });
  });

  it('turns automatic refunds off when an outstanding leg is not Paystack', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 8000,
      transactions: [leg({ id: 'a' }), leg({ id: 'b', gateway: 'korapay' })],
    });
    expect(plan).toEqual({ amount: 10000, automaticSupported: false });
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
          gateway: 'korapay',
          payment_transaction_id: 'b',
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
    });
    expect(plan).toEqual({ amount: 5000, automaticSupported: true });
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

  it('falls back to the total for a paid order with unknown ledger', () => {
    expect(
      getAutomaticCancelRefundAmount({ paymentStatus: 'Paid', total: 4000 })
    ).toBe(4000);
    expect(
      getAutomaticCancelRefundAmount({ paymentStatus: 'Pending', total: 4000 })
    ).toBe(0);
  });
});
