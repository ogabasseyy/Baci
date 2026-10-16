import { describe, expect, it } from 'vitest';
import { shouldShowOrderRefundPanel } from './should-show-order-refund-panel';

function order(overrides: Record<string, unknown> = {}) {
  return {
    paymentStatus: 'Paid',
    shippingStatus: 'Cancelled',
    ...overrides,
  };
}

describe('shouldShowOrderRefundPanel', () => {
  it('shows cancelled funded orders', () => {
    expect(shouldShowOrderRefundPanel(order())).toBe(true);
  });

  it('hides non-cancelled orders', () => {
    expect(
      shouldShowOrderRefundPanel(order({ shippingStatus: 'Processing' }))
    ).toBe(false);
  });

  it('hides unfunded cancellations', () => {
    expect(
      shouldShowOrderRefundPanel(
        order({ paymentStatus: 'Pending', transactions: [] })
      )
    ).toBe(false);
  });

  it('shows pending-status orders with a funded leg', () => {
    expect(
      shouldShowOrderRefundPanel(
        order({
          paymentStatus: 'Pending',
          transactions: [
            { amount: 100, status: 'completed', transaction_type: 'payment' },
          ],
        })
      )
    ).toBe(true);
  });

  it('fails open when the transactions read failed', () => {
    expect(
      shouldShowOrderRefundPanel(
        order({ paymentStatus: 'Pending', transactions: undefined })
      )
    ).toBe(true);
  });
});
