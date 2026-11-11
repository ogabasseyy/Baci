import { describe, expect, it } from 'vitest';
import { getCancelRefundPlan } from './cancel-refund-plan';
import { leg } from './cancel-refund-plan.test-support';

describe('getCancelRefundPlan currency handling', () => {
  it('matches currency codes that differ only by case or padding, like the worker', () => {
    const plan = getCancelRefundPlan({
      paymentStatus: 'Paid',
      total: 100,
      transactions: [
        leg({ amount: 100, currency: 'NGN' }),
        {
          amount: 100,
          currency: ' ngn ',
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

  it('never sums legs in different currencies', () => {
    const plan = getCancelRefundPlan({
      orderCurrency: 'NGN',
      paymentStatus: 'Paid',
      total: 100,
      transactions: [
        leg({ amount: 100, currency: 'NGN' }),
        leg({ amount: 100, currency: 'USD', id: 'leg-2' }),
      ],
    });
    expect(plan.ledgerKnown).toBe(false);
  });

  it('treats an open leg with no currency as unresolved', () => {
    const plan = getCancelRefundPlan({
      orderCurrency: 'NGN',
      paymentStatus: 'Paid',
      total: 100,
      transactions: [leg({ amount: 100, currency: null })],
    });
    expect(plan.ledgerKnown).toBe(false);
  });

  it('keeps a single-currency order resolved', () => {
    const plan = getCancelRefundPlan({
      orderCurrency: 'NGN',
      paymentStatus: 'Paid',
      total: 100,
      transactions: [leg({ amount: 100, currency: 'NGN' })],
    });
    expect(plan.ledgerKnown).toBe(true);
  });
});
