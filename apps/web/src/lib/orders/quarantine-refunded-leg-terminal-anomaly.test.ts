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

describe('quarantineRefundedLegTerminalAnomaly', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves clean when no rows and matching currency remain', async () => {
    const { from, reviewInsert } = probeClient({
      legs: [refundedLeg()],
      refundRows: [],
    });
    await expect(
      quarantineRefundedLegTerminalAnomaly({
        legs: [refundedLeg() as never],
        order: order as never,
        soleCompletedLegId: null,
        supabase: { from } as never,
      })
    ).resolves.toEqual({ refundedManualPendingLegIds: new Set() });
    expect(reviewInsert).not.toHaveBeenCalled();
  });

  it('quarantines invalid links instead of deferring past them', async () => {
    const { from, reviewInsert } = probeClient({
      legs: [refundedLeg()],
      refundRows: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          id: 'refund-1',
          metadata: { payment_transaction_id: 'payment-2' },
          status: 'completed',
        },
      ],
    });
    const error = await quarantineRefundedLegTerminalAnomaly({
      legs: [refundedLeg() as never],
      order: order as never,
      soleCompletedLegId: null,
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('outside this order'),
      })
    );
  });

  it('quarantines cross-gateway rows on refunded legs', async () => {
    const { from, reviewInsert } = probeClient({
      legs: [refundedLeg()],
      refundRows: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'korapay',
          id: 'refund-1',
          metadata: { payment_transaction_id: 'payment-1' },
          status: 'completed',
        },
      ],
    });
    const error = await quarantineRefundedLegTerminalAnomaly({
      legs: [refundedLeg() as never],
      order: order as never,
      soleCompletedLegId: null,
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason:
          'Completed cancellation refunds do not cover their payment legs; verify amounts before another provider refund',
      })
    );
  });

  it('quarantines completed-but-unverified provider rows', async () => {
    const { from, reviewInsert } = probeClient({
      legs: [refundedLeg()],
      refundRows: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          id: 'refund-1',
          metadata: { payment_transaction_id: 'payment-1' },
          status: 'completed',
        },
      ],
    });
    const error = await quarantineRefundedLegTerminalAnomaly({
      legs: [refundedLeg() as never],
      order: order as never,
      soleCompletedLegId: null,
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason:
          'Completed cancellation refunds do not cover their payment legs; verify amounts before another provider refund',
      })
    );
  });

  it('defers in-flight provider rows for the reconciler instead of quarantining', async () => {
    const { from, reviewInsert } = probeClient({
      legs: [refundedLeg()],
      refundRows: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: '42',
          id: 'refund-1',
          metadata: { payment_transaction_id: 'payment-1' },
          status: 'refund_pending',
        },
      ],
    });
    await expect(
      quarantineRefundedLegTerminalAnomaly({
        legs: [refundedLeg() as never],
        order: order as never,
        soleCompletedLegId: null,
        supabase: { from } as never,
      })
    ).resolves.toEqual({ refundedManualPendingLegIds: new Set() });
    expect(reviewInsert).not.toHaveBeenCalled();
  });

  it('resolves a clean refunded leg beside an actionable sibling', async () => {
    const legs = [
      refundedLeg(),
      refundedLeg({
        gateway_reference: 'paystack-ref-2',
        id: 'payment-2',
        status: 'completed',
      }),
    ];
    const { from, reviewInsert } = probeClient({ legs, refundRows: [] });
    await expect(
      quarantineRefundedLegTerminalAnomaly({
        legs: legs as never,
        order: order as never,
        soleCompletedLegId: 'payment-2',
        supabase: { from } as never,
      })
    ).resolves.toEqual({ refundedManualPendingLegIds: new Set() });
    expect(reviewInsert).not.toHaveBeenCalled();
  });

  it('forgives an unlinked row the main flow attributes to a covered sole leg', async () => {
    const legs = [
      refundedLeg(),
      refundedLeg({
        gateway_reference: 'paystack-ref-2',
        id: 'payment-2',
        status: 'completed',
      }),
    ];
    const { from, reviewInsert } = probeClient({
      legs,
      refundRows: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: '42',
          id: 'refund-1',
          metadata: { provider_refund_status: 'processed' },
          status: 'completed',
        },
      ],
    });
    await expect(
      quarantineRefundedLegTerminalAnomaly({
        legs: legs as never,
        order: order as never,
        soleCompletedLegId: 'payment-2',
        supabase: { from } as never,
      })
    ).resolves.toEqual({ refundedManualPendingLegIds: new Set() });
    expect(reviewInsert).not.toHaveBeenCalled();
  });

  it('leaves actionable-leg mismatches for the main flow', async () => {
    const legs = [
      refundedLeg(),
      refundedLeg({
        gateway_reference: 'paystack-ref-2',
        id: 'payment-2',
        status: 'completed',
      }),
    ];
    const { from, reviewInsert } = probeClient({
      legs,
      refundRows: [
        {
          amount: 10,
          currency: 'NGN',
          gateway: 'korapay',
          id: 'refund-1',
          metadata: { payment_transaction_id: 'payment-2' },
          status: 'completed',
        },
      ],
    });
    await expect(
      quarantineRefundedLegTerminalAnomaly({
        legs: legs as never,
        order: order as never,
        soleCompletedLegId: 'payment-2',
        supabase: { from } as never,
      })
    ).resolves.toEqual({ refundedManualPendingLegIds: new Set() });
    expect(reviewInsert).not.toHaveBeenCalled();
  });
});
