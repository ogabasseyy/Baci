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
  gateway: 'paystack',
  providerAmount: 10000,
  providerCurrency: 'NGN',
  providerReference: '123456789',
  providerStatus: 'success',
};

describe('fileDuplicatePaymentCapture', () => {
  it('files the review and stamps the row resolved', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const db = {
      from: vi.fn(() => ({ insert })),
      rpc,
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
        paystack_ref: 'BAC-OLD',
        reason: expect.stringContaining('Stale paystack attempt BAC-OLD'),
        txn_id: 'attempt-1',
        metadata: expect.objectContaining({
          gateway: 'paystack',
          gateway_reference: 'BAC-OLD',
          provider_reference: '123456789',
        }),
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({
        p_expected_reference: 'BAC-OLD',
        p_resolution: 'verified_success_captured',
        p_transaction_id: 'attempt-1',
      })
    );
  });

  it('keeps non-Paystack references out of paystack_ref', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const db = {
      from: vi.fn(() => ({ insert })),
      rpc,
    };

    await expect(
      fileDuplicatePaymentCapture({
        attempt: { ...attempt, gateway_reference: 'BAC-JUICY' },
        evidence: {
          gateway: 'juicyway',
          providerAmount: 12.5,
          providerCurrency: 'USDC',
          providerReference: 'payment-1',
          providerStatus: 'Succeeded',
        },
        supabase: db as never,
      })
    ).resolves.toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        paystack_ref: null,
        reason: expect.stringContaining('Stale juicyway attempt BAC-JUICY'),
        metadata: expect.objectContaining({
          gateway: 'juicyway',
          gateway_reference: 'BAC-JUICY',
          provider_amount: 12.5,
          provider_currency: 'USDC',
          provider_reference: 'payment-1',
          provider_status: 'Succeeded',
        }),
      })
    );
    // The Paystack-gated stamp would return false for this row and retry
    // the oldest captured row forever; the neutral stamp retires it.
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_any_gateway_v1',
      expect.objectContaining({
        p_expected_reference: 'BAC-JUICY',
        p_resolution: 'verified_success_captured',
        p_transaction_id: 'attempt-1',
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.anything()
    );
  });

  it('merges into the open review on conflict', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const db = {
      from: vi.fn(() => ({ insert })),
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
      expect.objectContaining({
        p_charge_id: '123456789',
        p_gateway: 'paystack',
        p_gateway_reference: 'BAC-OLD',
        p_transaction_id: 'attempt-1',
        // Merged captures are stamped and never reselected: without
        // the provider evidence operations cannot reconcile a later
        // charge that differs from the local transaction.
        p_provider_amount: 10000,
        p_provider_currency: 'NGN',
        p_provider_status: 'success',
      })
    );
  });

  it('returns false when the merge fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: {} });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const db = {
      from: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        insert,
        is: vi.fn().mockReturnThis(),
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      })),
      rpc,
    };

    await expect(
      fileDuplicatePaymentCapture({
        attempt,
        evidence,
        supabase: db as never,
      })
    ).resolves.toBe(false);
    // A transport failure leaves the conflict unresolved: no ref-less
    // retry, which would collide again.
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('refiles without the shared reference when another order owns the ref slot', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: '23505' } })
      .mockResolvedValueOnce({ error: null });
    // Definitive false: no open review for this order, so the 23505
    // came from the global ref slot, not the order slot.
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValue({ data: true, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const db = {
      from: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        insert,
        is: vi.fn().mockReturnThis(),
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      })),
      rpc,
    };

    await expect(
      fileDuplicatePaymentCapture({
        attempt,
        evidence,
        supabase: db as never,
      })
    ).resolves.toBe(true);
    expect(insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ paystack_ref: null, txn_id: 'attempt-1' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({ p_transaction_id: 'attempt-1' })
    );
  });

  it('stamps without refiling when our own review already holds the evidence', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValue({ data: true, error: null });
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: 'review-1' }, error: null });
    const db = {
      from: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        insert,
        is: vi.fn().mockReturnThis(),
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      })),
      rpc,
    };

    await expect(
      fileDuplicatePaymentCapture({
        attempt,
        evidence,
        supabase: db as never,
      })
    ).resolves.toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'stamp_abandoned_sweep_resolution_v1',
      expect.objectContaining({ p_transaction_id: 'attempt-1' })
    );
  });

  it('returns false when the ref-less refiling also collides', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const db = {
      from: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        insert,
        is: vi.fn().mockReturnThis(),
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      })),
      rpc,
    };

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
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const db = {
      from: vi.fn(() => ({ insert })),
      rpc,
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
