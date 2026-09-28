import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileTerminalAttemptEvidenceMismatch } from './file-terminal-attempt-evidence-mismatch';

describe('fileTerminalAttemptEvidenceMismatch', () => {
  const attempt = {
    amount: 100,
    currency: 'NGN',
    gateway_reference: 'BAC-OLD',
    id: 'attempt-1',
    merchant_id: 'merchant-1',
    metadata: { paystack_payment_type: 'card' },
    order_id: 'order-1',
  };
  const evidence = {
    mismatchDetail: 'provider BAC-OLD 9900 NGN',
    mismatchKind: 'payment_evidence_mismatch',
    providerAmount: 9900,
    providerCurrency: 'NGN',
    providerReference: 'BAC-OLD',
    providerStatus: 'abandoned',
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

  it('files the mismatch review and stamps the sweep resolution', async () => {
    await expect(
      fileTerminalAttemptEvidenceMismatch({ attempt, evidence, supabase })
    ).resolves.toBe(true);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'abandoned_attempt_evidence_mismatch',
        merchant_id: 'merchant-1',
        order_id: 'order-1',
        paystack_ref: 'BAC-OLD',
        txn_id: 'attempt-1',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_expected_reference: 'BAC-OLD',
        p_resolution: 'terminal_evidence_mismatch',
        p_transaction_id: 'attempt-1',
      })
    );
  });

  it('merges into the existing review before stamping on conflict', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } });

    await expect(
      fileTerminalAttemptEvidenceMismatch({ attempt, evidence, supabase })
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'merge_abandoned_attempt_evidence_mismatch_v1',
      expect.objectContaining({
        p_gateway_reference: 'BAC-OLD',
        p_merchant_id: 'merchant-1',
        p_order_id: 'order-1',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({ p_resolution: 'terminal_evidence_mismatch' })
    );
  });

  it('returns false without stamping when the merge fails', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } });
    rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(
      fileTerminalAttemptEvidenceMismatch({ attempt, evidence, supabase })
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.anything()
    );
  });

  it('returns false without stamping on a non-conflict insert error', async () => {
    insert.mockResolvedValue({ error: { code: '40001' } });

    await expect(
      fileTerminalAttemptEvidenceMismatch({ attempt, evidence, supabase })
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns false when the resolution stamp fails', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(
      fileTerminalAttemptEvidenceMismatch({ attempt, evidence, supabase })
    ).resolves.toBe(false);
  });
});
