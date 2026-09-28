import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { discoverMcpProducts } from './discover-products';

function discoveryClient() {
  const products = [
    { id: 'laptop', name: 'Office Laptop', category: 'Laptops', brand: 'Dell', price: 80000, manage_stock: false },
    { id: 'camera', name: 'Security Camera', category: 'Accessories', price: 50000, manage_stock: false },
  ];
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(async () => ({ data: products, error: null })),
  };
  return {
    supabase: {
      from: vi.fn(() => ({ select: vi.fn(() => query) })),
      rpc: vi.fn(async () => ({ data: [], error: null })),
    } as unknown as SupabaseClient,
  };
}

describe('gated semantic discovery', () => {
  it('uses semantic candidates only after merchant, active, category, and price checks', async () => {
    const { supabase } = discoveryClient();
    const semanticSearch = vi.fn(async () => ['camera', 'laptop']);
    const result = await discoverMcpProducts({
      args: { query: 'work', category: 'Laptops', max_price: 100000, limit: 2 },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      semanticSearch,
      supabase,
    });
    expect(result.selectedProducts.map(({ product }) => product.id)).toEqual(['laptop']);
    expect(semanticSearch).toHaveBeenCalledWith('work');
  });

  it('falls back to lexical results when the optional embedding lookup fails', async () => {
    const { supabase } = discoveryClient();
    const result = await discoverMcpProducts({
      args: { query: 'work' }, merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      semanticSearch: async () => { throw new Error('provider unavailable'); },
      supabase,
    });
    expect(result.selectedProducts).toEqual([]);
  });

  it('uses the sanitized lexical brand and category for semantic candidates', async () => {
    const { supabase } = discoveryClient();
    const result = await discoverMcpProducts({
      args: { query: 'work', category: '***Laptops***', brand: '***Dell***' },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input.replace(/\*/g, ''),
      semanticSearch: async () => ['laptop'],
      supabase,
    });
    expect(result.selectedProducts.map(({ product }) => product.id)).toEqual(['laptop']);
  });
});
