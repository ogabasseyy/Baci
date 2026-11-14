import type { CancelRefundOrder } from './cancel-refund-plan';

export type Tx = NonNullable<CancelRefundOrder['transactions']>[number];

/** A funded NGN Paystack payment leg (id pay-1) for plan tests. */
export const payment100: Tx = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'ref',
  id: 'pay-1',
  status: 'completed',
  transaction_type: 'payment',
};

/** A refund row linked to pay-1 (completed by default); override as needed. */
export const pendingRow = (over: Record<string, unknown> = {}): Tx =>
  ({
    amount: 100,
    currency: 'NGN',
    gateway: 'paystack',
    id: 'refund-x',
    payment_transaction_id: 'pay-1',
    status: 'completed',
    transaction_type: 'refund',
    ...over,
  }) as Tx;

/** The generic ledger leg used by the amount/coverage tests. */
export const leg = (over: Record<string, unknown> = {}) => ({
  amount: 5000,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'ref',
  id: 'leg-1',
  status: 'completed',
  transaction_type: 'payment',
  ...over,
});
