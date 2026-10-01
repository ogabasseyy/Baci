import { beforeEach, describe, expect, it, vi } from 'vitest';

const reconcile = vi.hoisted(() => vi.fn());
const isDeterministic = vi.hoisted(() => vi.fn());
const fileReview = vi.hoisted(() => vi.fn());
vi.mock('./reconcile-paystack-cancellation-refund', () => ({
  reconcilePaystackCancellationRefund: reconcile,
}));
vi.mock('./is-deterministic-paystack-refund-error', () => ({
  isDeterministicRefundError: isDeterministic,
}));
vi.mock('./file-refund-evidence-review', () => ({
  fileRefundEvidenceReview: fileReview,
}));

import { reconcileCompletedPaystackCancellationRefunds } from './reconcile-completed-paystack-cancellation-refunds';

const legacyRefund = {
  id: 'refund-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  gateway_reference: '42',
  amount: 100,
  currency: 'NGN',
  status: 'completed',
  metadata: { payment_transaction_id: 'payment-1' },
};

function selectQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function updateChain() {
  const chain: { eq: ReturnType<typeof vi.fn> } = {
    eq: vi.fn(),
  };
  chain.eq.mockReturnValue(chain);
  return chain;
}

describe('legacy completed Paystack cancellation refunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcile.mockResolvedValue('updated');
    isDeterministic.mockReturnValue(false);
    fileReview.mockResolvedValue(undefined);
  });

  it('stops before the deadline so later phases keep their share', async () => {
    const from = vi
      .fn()
      .mockReturnValue({ select: vi.fn(() => selectQuery([legacyRefund])) });
    const supabase = { from } as never;

    await expect(
      reconcileCompletedPaystackCancellationRefunds(
        supabase,
        25,
        Date.now() - 1
      )
    ).resolves.toEqual({ checked: 0, failed: 0 });

    expect(reconcile).not.toHaveBeenCalled();
  });

  it('re-verifies completed rows only for cancelled orders still awaiting a refund transition', async () => {
    const refund = {
      id: 'refund-1',
      order_id: 'order-1',
      merchant_id: 'merchant-1',
      gateway_reference: '42',
      amount: 100,
      currency: 'NGN',
      status: 'completed',
      metadata: { payment_transaction_id: 'payment-1' },
    };
    const query = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [refund], error: null }),
    };
    const from = vi
      .fn()
      .mockReturnValueOnce({ select: vi.fn(() => query) })
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([])) });
    const supabase = { from } as never;

    await expect(
      reconcileCompletedPaystackCancellationRefunds(supabase)
    ).resolves.toEqual({ checked: 1, failed: 0 });

    expect(query.eq).toHaveBeenCalledWith('status', 'completed');
    expect(query.in).toHaveBeenCalledWith('cancellation_order.payment_status', [
      'paid',
      'partially_paid',
      'pending',
    ]);
    expect(query.in).toHaveBeenCalledWith(
      'cancellation_order.shipping_status',
      ['cancelled', 'canceled']
    );
    expect(query.limit).toHaveBeenCalledWith(25);
    expect(reconcile).toHaveBeenCalledWith(supabase, refund);
  });

  it('sweeps stale finalized refunds for contradictions within a small cap', async () => {
    const finalizedRefund = {
      ...legacyRefund,
      id: 'refund-finalized',
      cancellation_order: {
        payment_status: 'refunded',
        shipping_status: 'cancelled',
        cancelled_at: '2026-09-20T00:00:00Z',
      },
    };
    const finalizedQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue({ data: [finalizedRefund], error: null }),
    };
    const from = vi
      .fn()
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([])) })
      .mockReturnValueOnce({ select: vi.fn(() => finalizedQuery) });
    const supabase = { from } as never;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();

    await expect(
      reconcileCompletedPaystackCancellationRefunds(supabase)
    ).resolves.toEqual({ checked: 1, failed: 0 });

    // Finalized orders stay eligible, but only rows untouched for a
    // week and only a few per tick, so the sweep never crowds the
    // pre-finalization batch.
    expect(finalizedQuery.eq).toHaveBeenCalledWith(
      'cancellation_order.payment_status',
      'refunded'
    );
    const cutoff = finalizedQuery.lt.mock.calls.find(
      (call) => call[0] === 'updated_at'
    )?.[1] as string;
    expect(typeof cutoff).toBe('string');
    expect(Math.abs(Date.parse(cutoff) - Date.parse(weekAgo))).toBeLessThan(
      60_000
    );
    expect(finalizedQuery.limit).toHaveBeenCalledWith(5);
    expect(reconcile).toHaveBeenCalledWith(supabase, finalizedRefund);
  });

  it('reconciles finalized rows before the pre-finalization batch', async () => {
    const primaryRefund = { ...legacyRefund, id: 'refund-primary' };
    const finalizedRefund = { ...legacyRefund, id: 'refund-finalized' };
    const from = vi
      .fn()
      .mockReturnValueOnce({
        select: vi.fn(() => selectQuery([primaryRefund])),
      })
      .mockReturnValueOnce({
        select: vi.fn(() => selectQuery([finalizedRefund])),
      });
    const supabase = { from } as never;

    await expect(
      reconcileCompletedPaystackCancellationRefunds(supabase)
    ).resolves.toEqual({ checked: 2, failed: 0 });

    // Trailing the finalized sweep would let a sustained backlog
    // consume the row-start window and starve contradiction rechecks.
    expect(reconcile).toHaveBeenNthCalledWith(1, supabase, finalizedRefund);
    expect(reconcile).toHaveBeenNthCalledWith(2, supabase, primaryRefund);
  });

  it('sends completed refunds on payment-pending orders for verification', async () => {
    const refund = {
      ...legacyRefund,
      id: 'refund-wedged',
      cancellation_order: {
        payment_status: 'pending',
        shipping_status: 'cancelled',
        cancelled_at: '2026-09-27T00:00:00Z',
      },
    };
    const from = vi
      .fn()
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([refund])) })
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([])) });
    const supabase = { from } as never;

    await expect(
      reconcileCompletedPaystackCancellationRefunds(supabase)
    ).resolves.toEqual({ checked: 1, failed: 0 });

    expect(reconcile).toHaveBeenCalledWith(supabase, refund);
  });

  it('demotes a deterministic mismatch for pending re-tracking and files it for review', async () => {
    reconcile.mockRejectedValue(new Error('paystack_refund_evidence_mismatch'));
    isDeterministic.mockReturnValue(true);
    const auditedRefund = {
      ...legacyRefund,
      description: 'Refund for cancelled order #B-1',
    };
    const chain = updateChain();
    const update = vi.fn().mockReturnValue(chain);
    const from = vi
      .fn()
      .mockReturnValueOnce({
        select: vi.fn(() => selectQuery([auditedRefund])),
      })
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([])) })
      .mockReturnValueOnce({ update });
    const supabase = { from } as never;

    await expect(
      reconcileCompletedPaystackCancellationRefunds(supabase)
    ).resolves.toEqual({ checked: 1, failed: 1 });

    expect(update).toHaveBeenCalledWith({
      status: 'refund_pending',
      updated_at: expect.any(String),
    });
    expect(chain.eq).toHaveBeenCalledWith('id', 'refund-1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'completed');
    expect(fileReview).toHaveBeenCalledWith(
      supabase,
      auditedRefund,
      'paystack_refund_evidence_mismatch'
    );
    expect(fileReview.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0] as number
    );
  });

  it('rotates a legacy deterministic mismatch here instead of stranding it', async () => {
    reconcile.mockRejectedValue(new Error('paystack_refund_evidence_mismatch'));
    isDeterministic.mockReturnValue(true);
    const chain = updateChain();
    const update = vi.fn().mockReturnValue(chain);
    const from = vi
      .fn()
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([legacyRefund])) })
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([])) })
      .mockReturnValueOnce({ update });
    const supabase = { from } as never;

    await expect(
      reconcileCompletedPaystackCancellationRefunds(supabase)
    ).resolves.toEqual({ checked: 1, failed: 1 });

    // The legacy row carries no cancellation description, so the pending
    // worker would never select it after a demote; it stays completed and
    // rotates here so this recheck revisits it after operations intervenes.
    expect(fileReview).toHaveBeenCalledWith(
      supabase,
      legacyRefund,
      'paystack_refund_evidence_mismatch'
    );
    expect(update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
    expect(chain.eq).toHaveBeenCalledWith('id', 'refund-1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'completed');
  });

  it('rotates a transient failure without filing a review', async () => {
    reconcile.mockRejectedValue(
      new Error('paystack_refund_verification_unavailable')
    );
    isDeterministic.mockReturnValue(false);
    const chain = updateChain();
    const update = vi.fn().mockReturnValue(chain);
    const from = vi
      .fn()
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([legacyRefund])) })
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([])) })
      .mockReturnValueOnce({ update });
    const supabase = { from } as never;

    await expect(
      reconcileCompletedPaystackCancellationRefunds(supabase)
    ).resolves.toEqual({ checked: 1, failed: 1 });

    expect(update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
    expect(fileReview).not.toHaveBeenCalled();
  });

  it('fails the batch when a deterministic demote write fails', async () => {
    reconcile.mockRejectedValue(new Error('paystack_refund_evidence_mismatch'));
    isDeterministic.mockReturnValue(true);
    const chain = updateChain();
    Object.assign(chain, {
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
      then: (resolve: (result: { error: Error }) => void) =>
        resolve({ error: new Error('database unavailable') }),
    });
    const update = vi.fn().mockReturnValue(chain);
    const from = vi
      .fn()
      .mockReturnValueOnce({
        select: vi.fn(() =>
          selectQuery([
            {
              ...legacyRefund,
              description: 'Refund for cancelled order #B-1',
            },
          ])
        ),
      })
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([])) })
      .mockReturnValueOnce({ update });

    await expect(
      reconcileCompletedPaystackCancellationRefunds({ from } as never)
    ).rejects.toThrow('completed_refund_demote_failed');
    expect(fileReview).toHaveBeenCalled();
  });

  it('keeps the row completed when the review write fails before demotion', async () => {
    reconcile.mockRejectedValue(new Error('paystack_refund_evidence_mismatch'));
    isDeterministic.mockReturnValue(true);
    fileReview.mockRejectedValue(
      new Error('refund_evidence_review_persistence_failed')
    );
    const chain = updateChain();
    const update = vi.fn().mockReturnValue(chain);
    const from = vi
      .fn()
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([legacyRefund])) })
      .mockReturnValueOnce({ select: vi.fn(() => selectQuery([])) })
      .mockReturnValueOnce({ update });

    await expect(
      reconcileCompletedPaystackCancellationRefunds({ from } as never)
    ).rejects.toThrow('refund_evidence_review_persistence_failed');
    expect(update).not.toHaveBeenCalled();
  });
});
