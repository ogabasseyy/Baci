import { describe, expect, it, vi } from 'vitest';
import { hasSettledPaystackOrderPaymentReference } from './has-settled-paystack-order-payment-reference';

describe('hasSettledPaystackOrderPaymentReference', () => {
  it('returns true when a completed Paystack order transaction already owns the reference', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: 'tx-1' }],
      error: null,
    });
    const not = vi.fn(() => ({ limit }));
    const eq3 = vi.fn(() => ({ not }));
    const eq2 = vi.fn(() => ({ eq: eq3 }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ select }));
    const supabase = { from } as unknown as Parameters<
      typeof hasSettledPaystackOrderPaymentReference
    >[0]['supabase'];

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('transactions');
    expect(eq1).toHaveBeenCalledWith('gateway', 'paystack');
    expect(eq2).toHaveBeenCalledWith('gateway_reference', 'R1');
    expect(eq3).toHaveBeenCalledWith('status', 'completed');
  });

  it('returns false when no completed Paystack order transaction matches', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const not = vi.fn(() => ({ limit }));
    const eq3 = vi.fn(() => ({ not }));
    const eq2 = vi.fn(() => ({ eq: eq3 }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ select }));
    const supabase = { from } as unknown as Parameters<
      typeof hasSettledPaystackOrderPaymentReference
    >[0]['supabase'];

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(false);
    expect(eq1).toHaveBeenCalledWith('gateway', 'paystack');
  });

  it('bugfix: does not treat a same-reference Korapay order payment as Paystack replay', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const not = vi.fn(() => ({ limit }));
    const eq3 = vi.fn(() => ({ not }));
    const eq2 = vi.fn(() => ({ eq: eq3 }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ select }));
    const supabase = { from } as unknown as Parameters<
      typeof hasSettledPaystackOrderPaymentReference
    >[0]['supabase'];

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'SHARED-REF',
        supabase,
      })
    ).resolves.toBe(false);
    expect(eq1).toHaveBeenCalledWith('gateway', 'paystack');
    expect(eq1).not.toHaveBeenCalledWith('gateway_reference', 'SHARED-REF');
  });
});
