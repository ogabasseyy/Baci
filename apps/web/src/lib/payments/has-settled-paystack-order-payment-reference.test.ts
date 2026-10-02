import { describe, expect, it, vi } from 'vitest';
import { hasSettledPaystackOrderPaymentReference } from './has-settled-paystack-order-payment-reference';

function database(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  const not = vi.fn(() => ({ limit }));
  const eq3 = vi.fn(() => ({ not }));
  const eq2 = vi.fn(() => ({ eq: eq3 }));
  const ilike = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ ilike }));
  const from = vi.fn(() => ({ select }));
  const supabase = { from } as unknown as Parameters<
    typeof hasSettledPaystackOrderPaymentReference
  >[0]['supabase'];
  return { eq2, eq3, from, ilike, select, supabase };
}

describe('hasSettledPaystackOrderPaymentReference', () => {
  it('returns true when a completed Paystack order transaction already owns the reference', async () => {
    const { eq2, eq3, from, ilike, select, supabase } = database([
      { gateway: 'paystack', id: 'tx-1' },
    ]);

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('transactions');
    expect(select).toHaveBeenCalledWith('id, gateway');
    expect(ilike).toHaveBeenCalledWith('gateway', '%paystack%');
    expect(eq2).toHaveBeenCalledWith('gateway_reference', 'R1');
    expect(eq3).toHaveBeenCalledWith('status', 'completed');
  });

  it('returns false when no completed Paystack order transaction matches', async () => {
    const { ilike, supabase } = database([]);

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(false);
    expect(ilike).toHaveBeenCalledWith('gateway', '%paystack%');
  });

  it.each([
    'Paystack',
    ' paystack ',
  ])('returns true for a legacy payment stored as %s', async (gateway) => {
    const { supabase } = database([{ gateway, id: 'tx-1' }]);

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'R1',
        supabase,
      })
    ).resolves.toBe(true);
  });

  it('bugfix: does not treat a same-reference Korapay order payment as Paystack replay', async () => {
    const { ilike, supabase } = database([
      { gateway: 'korapay', id: 'tx-foreign' },
    ]);

    await expect(
      hasSettledPaystackOrderPaymentReference({
        gatewayReference: 'SHARED-REF',
        supabase,
      })
    ).resolves.toBe(false);
    expect(ilike).toHaveBeenCalledWith('gateway', '%paystack%');
  });
});
