import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { buildMcpProductDetail } from './product-detail';

const product = {
  id: 'option-phone', name: 'Option Phone', slug: null, price: 100000,
  compare_at_price: null, images: [], description: null, stock_quantity: 0,
  manage_stock: true, condition: 'new', condition_detail: null, brand: null,
  category: null, has_variants: true, has_condition_offers: false, schema_markup: null,
};

describe('buildMcpProductDetail', () => {
  it('does not claim option availability when the public variant lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: 'unavailable' } })) } as unknown as SupabaseClient;
    try {
      const result = await buildMcpProductDetail({
        product, supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined,
      });
      expect(result.content[0].text).toBe('Product variants are temporarily unavailable.');
      expect(result.structuredContent).toBeUndefined();
    } finally {
      error.mockRestore();
    }
  });
});
