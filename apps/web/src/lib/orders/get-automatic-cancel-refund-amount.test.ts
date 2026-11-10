import { describe, expect, it } from 'vitest';
import { getAutomaticCancelRefundAmount } from './get-automatic-cancel-refund-amount';

const leg = (over: Record<string, unknown> = {}) => ({
  amount: 5000,
  gateway: 'paystack',
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

  it('counts legs whose provider refund is pending or done, like the RPC', () => {
    expect(
      getAutomaticCancelRefundAmount({
        paymentStatus: 'Paid',
        total: 10000,
        transactions: [
          leg({ status: 'refund_pending' }),
          leg({ status: 'refunded' }),
        ],
      })
    ).toBe(10000);
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
