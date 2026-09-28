import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileInvalidAttemptReference } from './file-invalid-attempt-reference';

describe('fileInvalidAttemptReference', () => {
  const attempt = {
    gateway_reference: 'not a reference!',
    id: 'attempt-1',
    merchant_id: 'merchant-1',
    metadata: {},
    order_id: 'order-1',
  };

  const insert = vi.fn();
  const update = vi.fn();
  const supabase = {
    from: vi.fn((table: string) =>
      table === 'reconciliation_review' ? { insert } : { update }
    ),
  } as never;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
    update.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it('files the invalid-reference review and stamps the sweep resolution', async () => {
    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(true);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'abandoned_attempt_evidence_mismatch',
        paystack_ref: 'not a reference!',
        txn_id: 'attempt-1',
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          abandoned_sweep_resolution: 'invalid_reference',
        }),
      })
    );
  });

  it('retries the stamp when a review already occupies the slot', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } });

    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalled();
  });

  it('returns false without stamping on a non-conflict insert error', async () => {
    insert.mockResolvedValue({ error: { code: '40001' } });

    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns false when the resolution stamp fails', async () => {
    update.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: new Error('stamp failed') }),
    });

    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(false);
  });
});
