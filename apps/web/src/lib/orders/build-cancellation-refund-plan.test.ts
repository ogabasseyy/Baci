import { describe, expect, it } from 'vitest';
import { buildCancellationRefundPlan } from './build-cancellation-refund-plan';

const payment = {
  id: 'p1',
  amount: 100,
  gateway: 'paystack',
  gateway_reference: 'capture-1',
};
describe('buildCancellationRefundPlan', () => {
  it('accounts for wallet refunds without reducing a different gateway leg', () => {
    const result = buildCancellationRefundPlan(
      [payment],
      [{ amount: 20, status: 'completed', gateway: 'wallet' }],
      120
    );
    expect(result[0].transactionAmount).toBe(100);
  });
  it('blocks total refunds above the order amount even when individual legs look valid', () =>
    expect(() =>
      buildCancellationRefundPlan(
        [payment],
        [{ amount: 20, status: 'completed', gateway: 'wallet' }],
        100
      )
    ).toThrow('exceeds'));
  it('blocks duplicate capture references before any submission', () =>
    expect(() =>
      buildCancellationRefundPlan([payment, { ...payment, id: 'p2' }], [], 200)
    ).toThrow('Duplicate'));
  it('deducts a partial manual refund from its own capture', () =>
    expect(
      buildCancellationRefundPlan(
        [payment],
        [
          {
            amount: 20,
            status: 'completed',
            gateway: 'manual',
            metadata: { payment_transaction_id: 'p1' },
          },
        ],
        100
      )[0].transactionAmount
    ).toBe(80));
});
