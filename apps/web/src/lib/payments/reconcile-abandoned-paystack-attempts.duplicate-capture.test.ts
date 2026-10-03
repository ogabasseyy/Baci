import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';
import {
  candidate,
  createClient,
} from './reconcile-abandoned-paystack-attempts.test-support';

function withReviewTable(
  client: { from: unknown },
  reviewInsert: ReturnType<typeof vi.fn>,
  ownReview: unknown = null
) {
  const fromMock = client.from as ReturnType<typeof vi.fn>;
  const baseFrom = fromMock.getMockImplementation() as (
    table: string
  ) => unknown;
  fromMock.mockImplementation((table: string) => {
    if (table !== 'reconciliation_review') return baseFrom(table);
    // Own-review confirm chain for the duplicate filer's conflict
    // path, alongside the review insert.
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: ownReview, error: null }),
      select: vi.fn().mockReturnThis(),
    };
    return { insert: reviewInsert, ...chain };
  });
}

function verifiedSuccess(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    success: true,
    data: {
      reference: 'BAC-OLD',
      status: 'success',
      amount: 10000,
      currency: 'NGN',
      id: 111222333,
      ...overrides,
    },
  });
}

describe('abandoned Paystack attempt duplicate captures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('files a duplicate-capture review and retires a verified successful attempt', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    rpc.mockResolvedValueOnce({ data: [candidate], error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess(),
    });

    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.held).toEqual([]);
    expect(summary.retired).toEqual([]);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'duplicate_payment_capture_requires_review',
        order_id: 'order-1',
        merchant_id: 'merchant-1',
        txn_id: 'attempt-1',
        paystack_ref: 'BAC-OLD',
      })
    );
    expect(update).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_expected_reference: 'BAC-OLD',
        p_resolution: 'verified_success_captured',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'select_abandoned_paystack_attempt_candidates_v1',
      expect.objectContaining({ p_limit: 25 })
    );
  });

  it('merges into an already-filed duplicate-capture review', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    rpc.mockResolvedValueOnce({ data: [candidate], error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess(),
    });

    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.held).toEqual([]);
    expect(rpc).toHaveBeenCalledWith(
      'merge_duplicate_payment_capture_evidence_v1',
      expect.objectContaining({
        p_charge_id: '111222333',
        p_gateway: 'paystack',
        p_gateway_reference: 'BAC-OLD',
        p_merchant_id: 'merchant-1',
        p_order_id: 'order-1',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({ p_resolution: 'verified_success_captured' })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refiles without the shared reference when another order owns the ref slot', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: '23505' } })
      .mockResolvedValueOnce({ error: null });
    // Definitive merge false: no open review for this order, so the
    // conflict came from the global ref slot.
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [candidate], error: null })
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValue({ data: true, error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess(),
    });

    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.held).toEqual([]);
    expect(reviewInsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ paystack_ref: null, txn_id: 'attempt-1' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({ p_resolution: 'verified_success_captured' })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('holds a verified success when merging its evidence fails', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    rpc.mockResolvedValueOnce({ data: [candidate], error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess(),
    });

    expect(summary.reviewsFiled).toEqual([]);
    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([{ id: 'attempt-1', reason: 'success' }]);
    expect(update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
  });

  it.each([
    [{ amount: 9000 }, 'payment_evidence_mismatch'],
    [{ reference: 'OTHER' }, 'reference_mismatch'],
  ])('files a mismatched successful capture with its provider evidence', async (overrides, mismatch) => {
    const { client, update } = createClient();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    rpc.mockResolvedValueOnce({ data: [candidate], error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess(overrides),
    });

    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.held).toEqual([]);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'duplicate_payment_capture_requires_review',
        metadata: expect.objectContaining({
          evidence_mismatch: mismatch,
          provider_status: 'success',
        }),
      })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('holds a mismatched success under its mismatch reason when filing fails', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: 'XX000' } });
    withReviewTable(client, reviewInsert);

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess({ amount: 9000 }),
    });

    expect(summary.reviewsFiled).toEqual([]);
    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'payment_evidence_mismatch' },
    ]);
    expect(update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
  });

  it('holds a verified success when its review cannot be filed', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: 'XX000' } });
    withReviewTable(client, reviewInsert);

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess(),
    });

    expect(summary.reviewsFiled).toEqual([]);
    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([{ id: 'attempt-1', reason: 'success' }]);
    expect(update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
  });

  it('holds a verified success when its resolution stamp fails', async () => {
    const { client } = createClient();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    rpc.mockResolvedValueOnce({ data: [candidate], error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess(),
    });

    expect(summary.reviewsFiled).toEqual([]);
    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([{ id: 'attempt-1', reason: 'success' }]);
  });

  it('files a marked completed retry without re-finalizing or retiring it', async () => {
    const retryRows = [
      {
        ...candidate,
        metadata: { duplicate_capture_review_pending: true },
        status: 'completed',
      },
    ];
    const { client, update } = createClient([], {}, retryRows);
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    rpc.mockResolvedValueOnce({ data: retryRows, error: null });
    const finalizePayment = vi.fn();
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      finalizePayment,
      supabase: client as never,
      verify: verifiedSuccess(),
    });

    // The row already settled: only the duplicate review is still
    // owed, and success clears the retry marker.
    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.retired).toEqual([]);
    expect(summary.held).toEqual([]);
    expect(finalizePayment).not.toHaveBeenCalled();
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'duplicate_payment_capture_requires_review',
        txn_id: 'attempt-1',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'set_duplicate_capture_review_pending_v1',
      expect.objectContaining({
        p_pending: false,
        p_transaction_id: 'attempt-1',
      })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('files a marked completed retry under a reversed provider status', async () => {
    const retryRows = [
      {
        ...candidate,
        metadata: { duplicate_capture_review_pending: true },
        status: 'completed',
      },
    ];
    const { client, update } = createClient([], {}, retryRows);
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    rpc.mockResolvedValueOnce({ data: retryRows, error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess({ status: 'reversed' }),
    });

    // The funds settled, so a now-reversed charge owes the duplicate
    // review with the gateway's actual status — never a retire that
    // would un-complete the payment.
    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.retired).toEqual([]);
    expect(summary.failed).toBe(false);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ provider_status: 'reversed' }),
      })
    );
    expect(update).not.toHaveBeenCalled();
  });
});
