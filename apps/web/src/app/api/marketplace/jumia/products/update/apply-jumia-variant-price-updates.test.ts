import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { applyJumiaVariantPriceUpdates } from './apply-jumia-variant-price-updates';

function createSupabaseStub(result: { error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  return {
    supabase: { rpc } as never,
    rpc,
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

  it('persists every overridden variant price in one RPC call', async () => {
    const { supabase, rpc } = createSupabaseStub({ error: null });

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: { 'SKU-1': 900, 'SKU-2': 1800 },
      expectedUpdateToken: 'token-1',
    });

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('apply_jumia_variant_price_updates', {
      p_merchant_id: 'merchant-1',
      p_updates: [
        { id: 'map-1', price: 900 },
        { id: 'map-2', price: 1800 },
      ],
      p_expected_update_token: 'token-1',
    });
  });

  it('skips mappings without an override and succeeds without calls when empty', async () => {
    const { supabase, rpc } = createSupabaseStub({ error: null });

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: { 'SKU-2': 1800 },
      expectedUpdateToken: 'token-1',
    });

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('apply_jumia_variant_price_updates', {
      p_merchant_id: 'merchant-1',
      p_updates: [{ id: 'map-2', price: 1800 }],
      p_expected_update_token: 'token-1',
    });

    const empty = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: {},
      expectedUpdateToken: 'token-1',
    });
    expect(empty).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('reports failure when the atomic statement fails', async () => {
    const { supabase, rpc } = createSupabaseStub({
      error: { message: 'target not found' },
    });

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: { 'SKU-1': 900, 'SKU-2': 1800 },
      expectedUpdateToken: 'token-1',
    });

    expect(result).toEqual({
      ok: false,
      error: 'Failed to update local mapping',
      code: undefined,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('threads the database error code through for superseded writes', async () => {
    const { supabase } = createSupabaseStub({
      error: { message: 'superseded', code: '40001' },
    });

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: { 'SKU-1': 900 },
      expectedUpdateToken: 'token-1',
    });

    expect(result).toEqual({
      ok: false,
      error: 'Failed to update local mapping',
      code: '40001',
    });
  });
});
