import { describe, expect, it, vi } from 'vitest';
import { captureOrHoldRedvaultPayment } from '@/lib/payments/redvault-capture-hold';

function buildSupabase(
  data: unknown,
  error: unknown = null,
  paymentMethod = 'uba_redvault'
) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { payment_method: paymentMethod },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from, rpc };
}

const input = {
  gateway: 'paystack' as const,
  gatewayResponse: {
    amount: 12_500,
    currency: 'NGN',
    reference: 'RV-reference',
    status: 'success',
  },
  orderId: 'order-1',
  reference: 'RV-reference',
  transactionId: 'transaction-1',
};

describe('captureOrHoldRedvaultPayment', () => {
  it('returns the durable held result for a matching REDVAULT capture', async () => {
    const supabase = buildSupabase({
      duplicate: false,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });

    await expect(
      captureOrHoldRedvaultPayment({ ...input, supabase: supabase as never })
    ).resolves.toEqual({
      duplicate: false,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'capture_or_hold_uba_redvault_payment',
      expect.objectContaining({
        p_gateway: 'paystack',
        p_order_id: 'order-1',
        p_reference: 'RV-reference',
        p_transaction_id: 'transaction-1',
      })
    );
  });

  it.each([
    'capture_reference_mismatch',
    'capture_amount_mismatch',
    'capture_currency_mismatch',
  ])('keeps a %s capture held', async (reason) => {
    const supabase = buildSupabase({
      duplicate: false,
      kind: 'captured_held',
      reason,
    });

    await expect(
      captureOrHoldRedvaultPayment({ ...input, supabase: supabase as never })
    ).resolves.toMatchObject({ kind: 'captured_held', reason });
  });

  it('returns evidence review instead of a captured hold for non-success evidence', async () => {
    const supabase = buildSupabase({
      duplicate: false,
      kind: 'capture_evidence_review',
      reason: 'capture_status_not_success',
    });

    await expect(
      captureOrHoldRedvaultPayment({ ...input, supabase: supabase as never })
    ).resolves.toEqual({
      duplicate: false,
      kind: 'capture_evidence_review',
      reason: 'capture_status_not_success',
    });
  });

  it('accepts an idempotent duplicate held receipt', async () => {
    const supabase = buildSupabase({
      duplicate: true,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });

    await expect(
      captureOrHoldRedvaultPayment({ ...input, supabase: supabase as never })
    ).resolves.toMatchObject({ duplicate: true, kind: 'captured_held' });
  });

  it('leaves non-REDVAULT payment paths unchanged', async () => {
    const supabase = buildSupabase({ kind: 'not_redvault' }, null, 'paystack');

    await expect(
      captureOrHoldRedvaultPayment({ ...input, supabase: supabase as never })
    ).resolves.toEqual({ kind: 'not_redvault' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the capture RPC is unavailable', async () => {
    const supabase = buildSupabase(null, new Error('rpc unavailable'));

    await expect(
      captureOrHoldRedvaultPayment({ ...input, supabase: supabase as never })
    ).rejects.toThrow('rpc unavailable');
  });

  it('rejects an ordinary-payment RPC result for a REDVAULT order', async () => {
    const supabase = buildSupabase({ kind: 'not_redvault' });

    await expect(
      captureOrHoldRedvaultPayment({ ...input, supabase: supabase as never })
    ).rejects.toThrow('redvault_capture_hold_rpc_invalid_response');
  });
});
