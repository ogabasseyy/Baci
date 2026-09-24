import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { applyJumiaVariantPriceUpdates } from './apply-jumia-variant-price-updates';

function createSupabaseStub(results: Array<{ error: unknown }>) {
  const updates: unknown[] = [];
  let callIndex = 0;
  const from = vi.fn(() => ({
    update: vi.fn((payload: unknown) => {
      updates.push(payload);
      return {
        eq: vi.fn(() => ({
          eq: vi.fn(() => {
            const result = results[callIndex] ?? { error: null };
            callIndex += 1;
            return Promise.resolve(result);
          }),
        })),
      };
    }),
  }));
  return {
    supabase: { from } as never,
    from,
    updates,
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

  it('writes each overridden variant price and skips unlisted SKUs', async () => {
    const { supabase, from, updates } = createSupabaseStub([]);

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: { 'SKU-1': 900 },
    });

    expect(result).toEqual({ ok: true });
    expect(from).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      { jumia_price: 900, updated_at: expect.any(String) },
    ]);
  });

  it('rolls back applied prices when a later row write fails', async () => {
    const { supabase, updates } = createSupabaseStub([
      { error: null },
      { error: { message: 'write failed' } },
      { error: null },
    ]);

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
    expect(updates).toEqual([
      { jumia_price: 900, updated_at: expect.any(String) },
      { jumia_price: 1800, updated_at: expect.any(String) },
      { jumia_price: 1000, updated_at: expect.any(String) },
    ]);
  });

  it('restores null previous prices and tolerates rollback failures', async () => {
    const { supabase, updates } = createSupabaseStub([
      { error: null },
      { error: { message: 'write failed' } },
      { error: { message: 'rollback failed' } },
    ]);

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: [
        { id: 'map-1', jumia_sku: 'SKU-1', jumia_price: null },
        { id: 'map-2', jumia_sku: 'SKU-2', jumia_price: 2000 },
      ],
      prices: { 'SKU-1': 900, 'SKU-2': 1800 },
    });

    expect(result).toEqual({
      ok: false,
      error: 'Failed to update local mapping',
    });
    expect(updates).toHaveLength(3);
    expect(updates[2]).toEqual({
      jumia_price: null,
      updated_at: expect.any(String),
    });
  });

  it('succeeds without writes when no mapping has an override', async () => {
    const { supabase, from } = createSupabaseStub([]);

    const result = await applyJumiaVariantPriceUpdates({
      supabase,
      merchantId: 'merchant-1',
      mappings: MAPPINGS,
      prices: {},
    });

    expect(result).toEqual({ ok: true });
    expect(from).not.toHaveBeenCalled();
  });
});
