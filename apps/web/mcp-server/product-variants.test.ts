import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadMcpProductVariants } from './product-variants';

function createSupabase() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(async () => ({
      data: { id: 'phone-1', name: 'Phone', manage_stock: true, has_variants: true, has_condition_offers: false },
      error: null,
    })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return {
    from: vi.fn(() => query),
    query,
    rpc: vi.fn(async (name: string) =>
      name === 'get_storefront_product_variants'
        ? { data: [{ attributes: { color: 'Red' }, price_override: null, stock_quantity: 2 }], error: null }
        : { data: [], error: null }
    ),
  };
}

describe('loadMcpProductVariants', () => {
  it('returns tracked variant availability for a selected product', async () => {
    const supabase = createSupabase();
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' },
      merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value,
      formatPrice: (price) => `₦${price}`,
    });

    expect(result.structuredContent).toMatchObject({
      product_name: 'Phone',
      variants: [{ availability: 'in_stock', stock_quantity: 2 }],
    });
    expect(result.content[0].text).toContain('Colors:');
    expect(supabase.rpc).toHaveBeenCalledWith('get_storefront_product_variants', {
      p_product_ids: ['phone-1'],
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith('get_product_offers', expect.anything());
  });

  it('does not claim availability when the public variant RPC fails', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadMcpProductVariants({
        args: { product_id: 'phone-1' },
        merchantId: 'merchant-1',
        supabase: supabase as unknown as SupabaseClient,
        sanitizeString: (value) => value,
        formatPrice: String,
      });
      expect(result.content[0].text).toBe('Product variants are temporarily unavailable.');
      expect(result.structuredContent).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });

  it('preserves the unavailable response when a declared offer lookup fails', async () => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: { id: 'phone-1', name: 'Phone', manage_stock: true, has_variants: false, has_condition_offers: true },
      error: null,
    });
    supabase.rpc.mockImplementation(async (name: string) =>
      name === 'get_product_offers'
        ? { data: null, error: { message: 'unavailable' } }
        : { data: [{ attributes: { color: 'Red' }, price_override: null, stock_quantity: 2 }], error: null }
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadMcpProductVariants({
        args: { product_id: 'phone-1' }, merchantId: 'merchant-1',
        supabase: supabase as unknown as SupabaseClient,
        sanitizeString: (value) => value, formatPrice: String,
      });
      expect(result.content[0].text).toBe('Product offers are temporarily unavailable.');
      expect(result.structuredContent).toBeUndefined();
      expect(supabase.rpc).not.toHaveBeenCalledWith('get_storefront_product_variants', expect.anything());
    } finally {
      log.mockRestore();
    }
  });
});
