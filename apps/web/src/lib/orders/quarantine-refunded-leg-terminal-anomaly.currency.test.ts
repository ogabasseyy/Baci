import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  order,
  transactionQuery,
} from './execute-order-cancellation-side-effect.test-support';
import { quarantineRefundedLegTerminalAnomaly } from './quarantine-refunded-leg-terminal-anomaly';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

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

describe('quarantineRefundedLegTerminalAnomaly currency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('quarantines currency-mismatched refunded legs with no rows at all', async () => {
    const { from, reviewInsert } = probeClient({
      legs: [refundedLeg({ currency: 'USD' })],
      refundRows: [],
    });
    const error = await quarantineRefundedLegTerminalAnomaly({
      legs: [refundedLeg({ currency: 'USD' }) as never],
      order: order as never,
      soleCompletedLegId: null,
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Payment currency requires review before refund',
      })
    );
  });

  it('quarantines a foreign-currency refunded leg beside an actionable sibling', async () => {
    const legs = [
      refundedLeg({ currency: 'USD' }),
      refundedLeg({
        gateway_reference: 'paystack-ref-2',
        id: 'payment-2',
        status: 'completed',
      }),
    ];
    const { from, reviewInsert } = probeClient({ legs, refundRows: [] });
    const error = await quarantineRefundedLegTerminalAnomaly({
      legs: legs as never,
      order: order as never,
      soleCompletedLegId: 'payment-2',
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Payment currency requires review before refund',
      })
    );
  });
});
