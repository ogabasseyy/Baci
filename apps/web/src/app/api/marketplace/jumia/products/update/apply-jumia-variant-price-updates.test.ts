import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { applyJumiaVariantPriceUpdates } from './apply-jumia-variant-price-updates';

function createSupabaseStub(result: { error: unknown }) {
  const upsert = vi.fn(() => Promise.resolve(result));
  const from = vi.fn(() => ({ upsert }));
  return {
    supabase: { from } as never,
    from,
    upsert,
  };
}

const MAPPINGS = [
  { id: 'map-1', jumia_sku: 'SKU-1', jumia_price: 1000 },
  { id: 'map-2', jumia_sku: 'SKU-2', jumia_price: 2000 },
];

describe('applyJumiaVariantPriceUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes every overridden variant price in a single upsert', async () => {
    const { supabase, from, upsert } = createSupabaseStub({ error: null });

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: { 'SKU-1': 900, 'SKU-2': 1800 },
    });

    expect(result).toEqual({ ok: true });
    expect(from).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      [
        {
          id: 'map-1',
          merchant_id: 'merchant-1',
          jumia_price: 900,
          updated_at: expect.any(String),
        },
        {
          id: 'map-2',
          merchant_id: 'merchant-1',
          jumia_price: 1800,
          updated_at: expect.any(String),
        },
      ],
      { onConflict: 'id' }
    );
  });

  it('skips mappings without an override and succeeds without writes when empty', async () => {
    const { supabase, from, upsert } = createSupabaseStub({ error: null });

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: { 'SKU-2': 1800 },
    });

    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      [
        {
          id: 'map-2',
          merchant_id: 'merchant-1',
          jumia_price: 1800,
          updated_at: expect.any(String),
        },
      ],
      { onConflict: 'id' }
    );

    const empty = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: {},
    });
    expect(empty).toEqual({ ok: true });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('reports failure without partial writes when the statement fails', async () => {
    const { supabase, upsert } = createSupabaseStub({
      error: { message: 'statement failed' },
    });

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: { 'SKU-1': 900, 'SKU-2': 1800 },
    });

    expect(result).toEqual({
      ok: false,
      error: 'Failed to update local mapping',
    });
    // One statement only: either every row applies or none does, so no
    // compensating rollback requests are ever issued.
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
