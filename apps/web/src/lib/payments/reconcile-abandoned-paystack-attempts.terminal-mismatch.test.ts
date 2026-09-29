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

describe('abandoned Paystack attempt terminal mismatches', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { amount: 9900, currency: 'NGN' },
    { amount: 10000, currency: 'USD' },
  ])('files a terminal mismatch review for a verified abandoned attempt with mismatched payment evidence', async (evidence) => {
    const { client, update } = createClient();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    withReviewTable(client, reviewInsert);
    const verify = vi.fn().mockResolvedValue({
      success: true,
      data: { reference: 'BAC-OLD', status: 'abandoned', ...evidence },
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.held).toEqual([]);
    expect(summary.retired).toEqual([]);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'abandoned_attempt_evidence_mismatch',
        txn_id: 'attempt-1',
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          abandoned_sweep_resolution: 'terminal_evidence_mismatch',
        }),
      })
    );
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('resolves a terminal mismatch by stamping when its review slot is occupied', async () => {
    const { client, update } = createClient();
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });
    const verify = vi.fn().mockResolvedValue({
      success: true,
      data: {
        reference: 'BAC-OLD',
        status: 'failed',
        amount: 9900,
        currency: 'NGN',
      },
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.held).toEqual([]);
    expect(summary.failed).toBe(false);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          abandoned_sweep_resolution: 'terminal_evidence_mismatch',
        }),
      })
    );
  });
});
