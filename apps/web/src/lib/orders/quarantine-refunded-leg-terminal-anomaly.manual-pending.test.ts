import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  order,
  transactionQuery,
} from './execute-order-cancellation-side-effect.test-support';
import { quarantineRefundedLegTerminalAnomaly } from './quarantine-refunded-leg-terminal-anomaly';

const refundedLeg = (overrides: Record<string, unknown> = {}) => ({
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'paystack-ref-1',
  id: 'payment-1',
  status: 'refunded',
  ...overrides,
});

function probeClient({
  legs,
  refundRows,
}: {
  legs: unknown[];
  refundRows: unknown[];
}) {
  const reviewInsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_review') return { insert: reviewInsert };
    return transactionQuery(refundRows);
  });
  return { from, reviewInsert, legs };
}

describe('quarantineRefundedLegTerminalAnomaly manual pending', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns refunded legs still awaiting manual completion', async () => {
    const legs = [refundedLeg({ gateway: 'cash', gateway_reference: null })];
    const { from, reviewInsert } = probeClient({
      legs,
      refundRows: [
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'manual',
          id: 'refund-1',
          metadata: { payment_transaction_id: 'payment-1' },
          status: 'completed',
        },
      ],
    });

    // The partial manual neither covers nor quarantines the refunded
    // cash leg: the caller merges the id into the settle deferral so
    // the step waits for the merchant instead of completing with
    // money still outstanding.
    await expect(
      quarantineRefundedLegTerminalAnomaly({
        legs: legs as never,
        order: order as never,
        soleCompletedLegId: null,
        supabase: { from } as never,
      })
    ).resolves.toEqual({
      refundedManualPendingLegIds: new Set(['payment-1']),
    });
    expect(reviewInsert).not.toHaveBeenCalled();
  });
});
