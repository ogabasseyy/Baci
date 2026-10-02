import { describe, expect, it } from 'vitest';
import { remainingPaymentRefund } from './remaining-payment-refund';

const payment = { id: 'p1', amount: 27574.83, gateway: 'paystack' };
const refund = {
  amount: 10000,
  status: 'completed',
  metadata: { payment_transaction_id: 'p1' },
};
describe('remainingPaymentRefund', () => {
  it('deducts partial manual refunds without skipping the entire payment', () =>
    expect(remainingPaymentRefund(payment, [refund], 1)).toBe(17574.83));
  it('skips fully refunded payments', () =>
    expect(
      remainingPaymentRefund(payment, [{ ...refund, amount: 27574.83 }], 1)
    ).toBe(0));
  it('does not deduct failed refunds or another payment leg', () =>
    expect(
      remainingPaymentRefund(
        payment,
        [
          { ...refund, status: 'failed' },
          { ...refund, metadata: { payment_transaction_id: 'p2' } },
        ],
        2
      )
    ).toBe(27574.83));
  it('blocks pending refunds', () =>
    expect(() =>
      remainingPaymentRefund(payment, [{ ...refund, status: 'pending' }], 1)
    ).toThrow('still processing'));
  it('blocks over-refunded payments', () =>
    expect(() =>
      remainingPaymentRefund(payment, [{ ...refund, amount: 30000 }], 1)
    ).toThrow('exceeds'));
  it('blocks unallocated manual refunds rather than refunding the full payment again', () =>
    expect(() =>
      remainingPaymentRefund(
        payment,
        [{ amount: 10, gateway: 'manual', status: 'completed' }],
        1
      )
    ).toThrow('Unallocated'));
  it.each([
    Number.NaN,
    -1,
    Number.POSITIVE_INFINITY,
  ])('blocks invalid refund amounts %s', (amount) =>
    expect(() =>
      remainingPaymentRefund(payment, [{ ...refund, amount }], 1)
    ).toThrow('Invalid refund amount'));
  it('supports unambiguous historical full refunds', () =>
    expect(
      remainingPaymentRefund(
        payment,
        [{ amount: 27574.83, gateway: 'paystack', status: 'completed' }],
        1
      )
    ).toBe(0));
});
