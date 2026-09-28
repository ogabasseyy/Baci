import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { discoverMcpProducts } from './discover-products';

function discoveryClient(sameCreatedAt = false) {
  const products = [
    { id: 'laptop', name: 'Office Laptop', category: 'Laptops', brand: 'Dell', price: 80000, manage_stock: false, created_at: '2026-01-01T00:00:00Z' },
    { id: 'camera', name: 'Security Camera', category: 'Accessories', price: 50000, manage_stock: false, created_at: sameCreatedAt ? '2026-01-01T00:00:00Z' : '2026-09-01T00:00:00Z' },
  ];
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(async (_column: string, ids: string[]) => ({
      data: products.filter((product) => ids.includes(product.id)), error: null,
    })),
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
    expect(semanticSearch).toHaveBeenCalledWith('work', 0);
  });

  it('falls back to lexical results when the optional embedding lookup fails', async () => {
    const { supabase } = discoveryClient();
    const semanticSearch = vi.fn(async () => { throw new Error('provider unavailable'); });
    const result = await discoverMcpProducts({
      args: { query: 'office laptop' }, merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      semanticSearch,
      supabase,
    });
    expect(result.selectedProducts).toEqual([]);
    expect(semanticSearch).toHaveBeenCalledWith('office laptop', 0);
  });

  it('pages past filtered semantic candidates to find a matching product', async () => {
    const { supabase } = discoveryClient();
    const semanticSearch = vi.fn(async (_query: string, offset: number) =>
      offset === 0 ? Array.from({ length: 40 }, (_, index) => `other-${index}`) : ['laptop']
    );
    const result = await discoverMcpProducts({
      args: { query: 'office device', category: 'Laptops', limit: 1 },
      merchantId: 'merchant-1', sanitizeString: (input) => input,
      semanticSearch, supabase,
    });
    expect(result.selectedProducts.map(({ product }) => product.id)).toEqual(['laptop']);
    expect(semanticSearch.mock.calls.map(([, offset]) => offset)).toEqual([0, 40]);
  });

  it('does not reintroduce recommendations for an ambiguous single word', async () => {
    const { supabase } = discoveryClient();
    const semanticSearch = vi.fn(async () => ['laptop']);
    const result = await discoverMcpProducts({
      args: { query: 'work' }, merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      semanticSearch, supabase,
    });
    expect(result.selectedProducts).toEqual([]);
    expect(semanticSearch).not.toHaveBeenCalled();
  });

  it('does not turn a broad use-case phrase into semantic product recommendations', async () => {
    const { supabase } = discoveryClient();
    const semanticSearch = vi.fn(async () => ['laptop']);
    await discoverMcpProducts({
      args: { query: 'for work' }, merchantId: 'merchant-1',
      sanitizeString: (input) => input, semanticSearch, supabase,
    });
    expect(semanticSearch).not.toHaveBeenCalled();
  });

  it('does not treat a sanitized-empty category as a narrowing filter', async () => {
    const { supabase } = discoveryClient();
    const semanticSearch = vi.fn(async () => ['laptop']);
    await discoverMcpProducts({
      args: { query: 'work', category: '***' }, merchantId: 'merchant-1',
      sanitizeString: (input) => input.replace(/\*/g, ''),
      semanticSearch, supabase,
    });
    expect(semanticSearch).not.toHaveBeenCalled();
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

  it.each([false, true])('orders semantic candidates by newest date and then ID (equal dates: %s)', async (sameCreatedAt) => {
    const { supabase } = discoveryClient(sameCreatedAt);
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [{ product_id: 'laptop', total_count: 1 }], error: null,
    } as never);
    const result = await discoverMcpProducts({
      args: { query: 'smart gadget', sort: 'newest', limit: 2 },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      semanticSearch: async () => ['camera'],
      supabase,
    });
    expect(result.selectedProducts.map(({ product }) => product.id)).toEqual(['camera', 'laptop']);
  });
});
