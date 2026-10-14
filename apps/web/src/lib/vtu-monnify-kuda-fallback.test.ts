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
    status: 'processing',
    updated_at: 'tok-1',
  };
  const monnifyResult = {
    amount: 100,
    message: 'Monnify rejected the bill payment request.',
    providerErrorDetail: 'Monnify API error: 400',
    reference: 'VTU-123',
    status: 'failed',
    success: false,
  };

  function createSupabase(
    updateError: { message: string } | null = null,
    markedRow: { id: string; updated_at?: string } | null = updateError
      ? null
      : { id: 'vtu-1', updated_at: 'tok-2' }
  ) {
    const updatePayloads: unknown[] = [];
    const eqCalls: [string, unknown][] = [];
    // Chainable eq (Codex R96 P1): the CAS write filters id +
    // status (+ updated_at), then selects the matched row.
    const eq: ReturnType<typeof vi.fn> = vi.fn(
      (column: string, value: unknown) => {
        eqCalls.push([column, value]);
        return { eq, select };
      }
    );
    const maybeSingle = vi.fn(() =>
      Promise.resolve({ data: markedRow, error: updateError })
    );
    const select = vi.fn(() => ({ maybeSingle }));
    const update = vi.fn((payload: unknown) => {
      updatePayloads.push(payload);
      return { eq };
    });
    const supabase = {
      from: vi.fn(() => ({ update })),
    };
    return { eq, eqCalls, supabase, update, updatePayloads };
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

  it('gates the marker on the processing status and claimed token', async () => {
    const { eqCalls, supabase } = createSupabase();
    const row = { ...rowBase, metadata: { ...rowBase.metadata } };
    mockPurchaseAirtime.mockResolvedValueOnce({
      status: 'successful',
      success: true,
    });

    await executeMonnifyAirtimeKudaFallback({
      customerFirstName: 'OgaBassey',
      monnifyResult: monnifyResult as never,
      provider: 'MTN' as never,
      row,
      supabase: supabase as never,
    });

    expect(eqCalls).toContainEqual(['status', 'processing']);
    expect(eqCalls).toContainEqual(['updated_at', 'tok-1']);
    expect(row.updated_at).toBe('tok-2');
  });

  it('returns the Monnify rejection without calling Kuda on a zero-match lost race', async () => {
    // Codex R96 P1: this worker paused after its Monnify failure; a
    // replay reclaimed and settled the row. The CAS matches nothing
    // — vend nothing (refund path), exactly like a failed write.
    const { supabase } = createSupabase(null, null);
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
    expect(row.updated_at).toBe('tok-1');
  });
});
