import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMappingsEq, mockMappingsIn } = vi.hoisted(() => ({
  mockMappingsEq: vi.fn(),
  mockMappingsIn: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { loadJumiaImportMappings } from './load-jumia-import-mappings';

function makeSupabase(result: unknown) {
  const chain = {
    eq: (...args: unknown[]) => {
      mockMappingsEq(...args);
      return chain;
    },
    in: (...args: unknown[]) => {
      mockMappingsIn(...args);
      return Promise.resolve(result);
    },
  };
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => chain),
    })),
  };
}

describe('loadJumiaImportMappings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only mappings scoped to the selected marketplace', async () => {
    const supabase = makeSupabase({
      data: [
        { id: 'mapping-1', jumia_sku: 'SKU-1' },
        { id: 'mapping-2', jumia_sku: null },
      ],
      error: null,
    });

    const result = await loadJumiaImportMappings({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      shopId: 'shop-ng',
      marketplaceKey: 'NG',
      skus: ['SKU-1'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mappedSkus).toEqual(new Set(['SKU-1']));
    expect(mockMappingsEq).toHaveBeenCalledWith('jumia_shop_id', 'shop-ng');
    expect(mockMappingsEq).toHaveBeenCalledWith('marketplace_key', 'NG');
  });

  it('fails closed when the mapping lookup errors', async () => {
    const result = await loadJumiaImportMappings({
      supabase: makeSupabase({
        data: null,
        error: { message: 'db down' },
      }) as never,
      merchantId: 'merchant-1',
      shopId: 'shop-ng',
      marketplaceKey: 'NG',
      skus: ['SKU-1'],
    });

    expect(result).toEqual({ ok: false });
  });
});
