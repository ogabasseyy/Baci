import { describe, expect, it, vi } from 'vitest';
import { fileDuplicatePaymentCapture } from './file-duplicate-payment-capture';

const attempt = {
  gateway_reference: 'BAC-OLD',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  metadata: {},
  order_id: 'order-1',
};

const evidence = {
  providerAmount: 10000,
  providerCurrency: 'NGN',
  providerReference: 'BAC-OLD',
  providerStatus: 'success',
};

describe('fileDuplicatePaymentCapture', () => {
  it('files the review and stamps the row resolved', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) }));
    const db = {
      from: vi.fn((table: string) =>
        table === 'reconciliation_review' ? { insert } : { update }
      ),
    };

    await expect(
      fileDuplicatePaymentCapture({
        attempt,
        evidence,
        supabase: db as never,
      })
    ).resolves.toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'duplicate_payment_capture_requires_review',
        txn_id: 'attempt-1',
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          abandoned_sweep_resolution: 'verified_success_captured',
        }),
      })
    );
  });

  it('merges into the open review on conflict', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) }));
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const db = {
      from: vi.fn((table: string) =>
        table === 'reconciliation_review' ? { insert } : { update }
      ),
      rpc,
    };

    await expect(
      fileDuplicatePaymentCapture({
        attempt,
        evidence: {
          ...evidence,
          mismatchDetail: 'amount differs',
          mismatchKind: 'payment_evidence_mismatch',
        },
        supabase: db as never,
      })
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'merge_duplicate_payment_capture_evidence_v1',
      expect.objectContaining({ p_transaction_id: 'attempt-1' })
    );
  });

  it('returns false when the merge fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: {} });
    const db = { from: vi.fn(() => ({ insert })), rpc };

    await expect(
      fileDuplicatePaymentCapture({
        attempt,
        evidence,
        supabase: db as never,
      })
    ).resolves.toBe(false);
  });

  it('returns false on non-conflict review errors', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '50000' } });
    const db = { from: vi.fn(() => ({ insert })) };

    await expect(
      fileDuplicatePaymentCapture({
        attempt,
        evidence,
        supabase: db as never,
      })
    ).resolves.toBe(false);
  });

  it('returns false when the resolution stamp fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: { message: 'down' } }),
    }));
    const db = {
      from: vi.fn((table: string) =>
        table === 'reconciliation_review' ? { insert } : { update }
      ),
    };

    await expect(
      fileDuplicatePaymentCapture({
        attempt,
        evidence,
        supabase: db as never,
      })
    ).resolves.toBe(false);
  });
});
