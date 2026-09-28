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
  const rpc = vi.fn();
  const supabase = {
    from: vi.fn(() => ({ insert })),
    rpc,
  } as never;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ data: true, error: null });
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
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_expected_reference: 'not a reference!',
        p_resolution: 'invalid_reference',
        p_transaction_id: 'attempt-1',
      })
    );
  });

  it('merges into the existing review before stamping on conflict', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } });

    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'merge_abandoned_attempt_evidence_mismatch_v1',
      expect.objectContaining({
        p_merchant_id: 'merchant-1',
        p_order_id: 'order-1',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({ p_resolution: 'invalid_reference' })
    );
  });

  it('returns false without stamping when the merge fails', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } });
    rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.anything()
    );
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
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns false when the resolution stamp fails', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(false);
  });
});
