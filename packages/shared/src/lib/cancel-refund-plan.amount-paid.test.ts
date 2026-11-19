import { describe, expect, it } from 'vitest';
import { getCancelRefundPlan } from './cancel-refund-plan';
import { leg } from './cancel-refund-plan.test-support';

const order = (
  amountPaid: number | null | undefined,
  transactions: ReturnType<typeof leg>[]
) =>
  getCancelRefundPlan({
    amountPaid,
    orderCurrency: 'NGN',
    paymentStatus: 'Paid',
    total: 100,
    transactions,
  });

describe('getCancelRefundPlan recorded amount paid', () => {
  it('is neutral when two uncovered captures exceed the recorded paid amount', () => {
    const plan = order(100, [
      leg({ amount: 100, id: 'cap-1' }),
      leg({ amount: 100, id: 'cap-2' }),
    ]);
    expect(plan.ledgerKnown).toBe(false);
  });

  it('stays resolved when the outstanding capture fits the recorded amount', () => {
    expect(order(100, [leg({ amount: 100 })]).ledgerKnown).toBe(true);
  });

  it('treats a missing or unreadable amount paid as unresolved', () => {
    expect(order(null, [leg({ amount: 100 })]).ledgerKnown).toBe(false);
    expect(order(Number.NaN, [leg({ amount: 100 })]).ledgerKnown).toBe(false);
  });

  it('derives a never-stamped zero amount from the funded legs', () => {
    expect(order(0, [leg({ amount: 100 })]).ledgerKnown).toBe(true);
  });

  it('does not check when the caller cannot know the order row', () => {
    expect(
      order(undefined, [
        leg({ amount: 100, id: 'cap-1' }),
        leg({ amount: 100, id: 'cap-2' }),
      ]).ledgerKnown
    ).toBe(true);
  });

  it('ignores a fully refunded superseded capture', () => {
    const plan = order(100, [
      leg({ amount: 100, id: 'cap-1' }),
      leg({ amount: 100, id: 'cap-2', status: 'refunded' }),
    ]);
    expect(plan.ledgerKnown).toBe(true);
    expect(plan.amount).toBe(100);
  });
});
