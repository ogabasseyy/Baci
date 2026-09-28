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
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          abandoned_sweep_resolution: 'terminal_evidence_mismatch',
          paystack_payment_type: 'card',
        }),
      })
    );
  });

  it('returns false without stamping when a review already occupies the slot', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } });

    await expect(
      fileTerminalAttemptEvidenceMismatch({ attempt, evidence, supabase })
    ).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns false when the resolution stamp fails', async () => {
    update.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: new Error('stamp failed') }),
    });

    await expect(
      fileTerminalAttemptEvidenceMismatch({ attempt, evidence, supabase })
    ).resolves.toBe(false);
  });
});
