import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';
import {
  candidate,
  createClient,
} from './reconcile-abandoned-paystack-attempts.test-support';

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

describe('abandoned Paystack attempts with invalid references', () => {
  beforeEach(() => vi.clearAllMocks());

  function invalidCandidate() {
    return { ...candidate, gateway_reference: 'not a reference!' };
  }

  function invalidVerify() {
    return vi.fn().mockResolvedValue({
      code: 'VALIDATION_ERROR',
      error: 'Invalid transaction reference format',
      success: false,
    });
  }

  it('files a durable review instead of rotating an invalid reference', async () => {
    const { client } = createClient([invalidCandidate()]);
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: invalidVerify(),
    });

    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.held).toEqual([]);
    expect(summary.failed).toBe(false);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'abandoned_attempt_evidence_mismatch',
        paystack_ref: 'not a reference!',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_expected_reference: 'not a reference!',
        p_resolution: 'invalid_reference',
        p_transaction_id: 'attempt-1',
      })
    );
  });

  it('files a durable review when Paystack deterministically rejects the reference', async () => {
    const { client } = createClient();
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    withReviewTable(client, reviewInsert);
    Object.assign(client, { rpc });
    const verify = vi.fn().mockResolvedValue({
      code: 'HTTP_400',
      error: 'Bad request',
      success: false,
    });

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    // A 400 will never succeed on retry: holding it as an outage would
    // rotate updated_at forever while the pending row blocks merchant
    // cancellation and the cron reports success.
    expect(summary.reviewsFiled).toEqual(['attempt-1']);
    expect(summary.held).toEqual([]);
    expect(summary.failed).toBe(false);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'abandoned_attempt_evidence_mismatch',
        reason: expect.stringContaining('HTTP_400'),
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({ p_transaction_id: 'attempt-1' })
    );
  });

  it('fails the sweep when the invalid-reference review cannot be filed', async () => {
    const { client } = createClient([invalidCandidate()]);
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: 'XX000' } });
    withReviewTable(client, reviewInsert);

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: invalidVerify(),
    });

    expect(summary.reviewsFiled).toEqual([]);
    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'invalid_reference' },
    ]);
  });
});
