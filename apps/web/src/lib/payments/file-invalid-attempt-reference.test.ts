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

  it('files a missing-reference review without occupying the ref slot', async () => {
    await expect(
      fileInvalidAttemptReference({
        attempt: { ...attempt, gateway_reference: null },
        reason: 'gateway_reference_missing',
        supabase,
      })
    ).resolves.toBe(true);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'abandoned_attempt_evidence_mismatch',
        paystack_ref: null,
        txn_id: 'attempt-1',
        reason: expect.stringContaining('carries no gateway reference'),
        metadata: expect.objectContaining({ missing_reference: true }),
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_expected_reference: null,
        p_resolution: 'missing_reference',
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

  it('refiles without the reference and stamps when another order owns the ref slot', async () => {
    insert.mockResolvedValueOnce({ error: { code: '23505' } });
    rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(true);
    // The merge found no open review for this order, so the global
    // ref slot belongs to another order's capture: the refile keeps
    // this attempt's own operations review without colliding forever.
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        issue_type: 'abandoned_attempt_evidence_mismatch',
        order_id: 'order-1',
        paystack_ref: null,
        txn_id: 'attempt-1',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({ p_resolution: 'invalid_reference' })
    );
  });

  it('returns false without stamping when the merge errors', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } });
    rpc.mockResolvedValueOnce({ data: null, error: new Error('db down') });

    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.anything()
    );
  });

  it('returns false without stamping when the ref-less refile collides', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } });
    rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(
      fileInvalidAttemptReference({
        attempt,
        reason: 'Invalid transaction reference format',
        supabase,
      })
    ).resolves.toBe(false);
    expect(insert).toHaveBeenCalledTimes(2);
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
