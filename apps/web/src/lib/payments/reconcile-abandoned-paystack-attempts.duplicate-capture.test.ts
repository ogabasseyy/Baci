import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';
import { createClient } from './reconcile-abandoned-paystack-attempts.test-support';

function withReviewTable(
  client: { from: unknown },
  reviewInsert: ReturnType<typeof vi.fn>
) {
  const fromMock = client.from as ReturnType<typeof vi.fn>;
  const baseFrom = fromMock.getMockImplementation() as (
    table: string
  ) => unknown;
  fromMock.mockImplementation((table: string) =>
    table === 'reconciliation_review'
      ? { insert: reviewInsert }
      : baseFrom(table)
  );
}

function verifiedSuccess(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    success: true,
    data: {
      reference: 'BAC-OLD',
      status: 'success',
      amount: 10000,
      currency: 'NGN',
      ...overrides,
    },
  });
}

describe('abandoned Paystack attempt duplicate captures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('files a duplicate-capture review and retires a verified successful attempt', async () => {
    const { client, lookup, update } = createClient();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    withReviewTable(client, reviewInsert);

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
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          abandoned_sweep_resolution: 'verified_success_captured',
        }),
        updated_at: expect.any(String),
      })
    );
    expect(lookup.is).toHaveBeenCalledWith(
      'metadata->abandoned_sweep_resolution',
      null
    );
  });

  it('merges into an already-filed duplicate-capture review', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
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
        p_gateway_reference: 'BAC-OLD',
        p_merchant_id: 'merchant-1',
        p_order_id: 'order-1',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('holds a verified success when merging its evidence fails', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess(),
    });

    expect(summary.reviewsFiled).toEqual([]);
    expect(summary.failed).toBe(false);
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
    withReviewTable(client, reviewInsert);

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
    expect(update).toHaveBeenCalledTimes(1);
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
    expect(summary.failed).toBe(false);
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
    expect(summary.failed).toBe(false);
    expect(summary.held).toEqual([{ id: 'attempt-1', reason: 'success' }]);
    expect(update).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
  });

  it('holds a verified success when its resolution stamp fails', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    withReviewTable(client, reviewInsert);
    const stampChain = { eq: vi.fn(), select: vi.fn() };
    stampChain.eq.mockReturnValue(stampChain);
    Object.assign(stampChain, {
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
      then: (resolve: (result: { error: Error }) => void) =>
        resolve({ error: new Error('stamp unavailable') }),
    });
    update.mockReturnValueOnce(stampChain);

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verifiedSuccess(),
    });

    expect(summary.reviewsFiled).toEqual([]);
    expect(summary.failed).toBe(false);
    expect(summary.held).toEqual([{ id: 'attempt-1', reason: 'success' }]);
  });
});
