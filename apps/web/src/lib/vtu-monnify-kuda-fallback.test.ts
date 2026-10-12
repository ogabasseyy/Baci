import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMonnifyAirtimeKudaFallback } from './vtu-monnify-kuda-fallback';

const mockPurchaseAirtime = vi.fn();
vi.mock('@/lib/kuda', () => ({
  purchaseAirtime: (...args: unknown[]) => mockPurchaseAirtime(...args),
}));

describe('executeMonnifyAirtimeKudaFallback', () => {
  const rowBase = {
    amount: 100,
    id: 'vtu-1',
    metadata: {
      billerCode: 'MTN',
      productCode: '13',
      provider: 'monnify',
    },
    phone_number: '08012345678',
    request_reference: 'VTU-123',
  };
  const monnifyResult = {
    amount: 100,
    message: 'Monnify rejected the bill payment request.',
    providerErrorDetail: 'Monnify API error: 400',
    reference: 'VTU-123',
    status: 'failed',
    success: false,
  };

  function createSupabase(updateError: { message: string } | null = null) {
    const updatePayloads: unknown[] = [];
    const eq = vi.fn(() => Promise.resolve({ error: updateError }));
    const update = vi.fn((payload: unknown) => {
      updatePayloads.push(payload);
      return { eq };
    });
    const supabase = {
      from: vi.fn(() => ({ update })),
    };
    return { eq, supabase, update, updatePayloads };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists Kuda routing before calling Kuda and returns the patched result', async () => {
    const { supabase, updatePayloads } = createSupabase();
    mockPurchaseAirtime.mockImplementationOnce(async () => {
      // Ordering proof: the marker write already landed when Kuda
      // is called, so a result-persist crash still leaves a
      // Kuda-reconcilable row.
      expect(updatePayloads).toHaveLength(1);
      return {
        amount: 100,
        message: 'Request successful',
        phoneNumber: '08012345678',
        provider: 'MTN',
        reference: 'VTU-123',
        status: 'successful',
        success: true,
        transactionId: 'kuda-airtime-1',
      };
    });
    const row = { ...rowBase, metadata: { ...rowBase.metadata } };

    const result = await executeMonnifyAirtimeKudaFallback({
      customerFirstName: 'OgaBassey',
      monnifyResult: monnifyResult as never,
      provider: 'MTN' as never,
      row,
      supabase: supabase as never,
    });

    expect(supabase.from).toHaveBeenCalledWith('vtu_transactions');
    expect(updatePayloads).toEqual([
      {
        metadata: expect.objectContaining({
          fulfillmentProvider: 'kuda',
          monnifyFallbackError: 'Monnify API error: 400',
          originalProvider: 'monnify',
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
        }),
      },
    ]);
    expect(row.metadata.provider).toBe('kuda');
    expect(mockPurchaseAirtime).toHaveBeenCalledWith(
      '08012345678',
      100,
      'MTN',
      'OgaBassey',
      'VTU-123'
    );
    expect(result).toMatchObject({
      status: 'successful',
      transactionId: 'kuda-airtime-1',
      metadataPatch: expect.objectContaining({ provider: 'kuda' }),
    });
  });

  it('returns the Monnify rejection without calling Kuda when the marker write fails', async () => {
    const { supabase } = createSupabase({ message: 'marker unavailable' });
    const row = { ...rowBase, metadata: { ...rowBase.metadata } };

    const result = await executeMonnifyAirtimeKudaFallback({
      customerFirstName: 'OgaBassey',
      monnifyResult: monnifyResult as never,
      provider: 'MTN' as never,
      row,
      supabase: supabase as never,
    });

    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(result).toBe(monnifyResult);
    expect(row.metadata.provider).toBe('monnify');
  });
});
