import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { discoverMcpProducts } from './discover-products';

vi.mock('./search-products-query', () => ({
  loadMcpSearchProducts: vi.fn(async () => ({
    products: [
      { id: 'expensive-1', name: 'Laptop A', category: 'Laptops', price: 150000 },
      { id: 'expensive-2', name: 'Laptop B', category: 'Laptops', price: 160000 },
    ],
    limit: 2,
    priceScanComplete: true,
    sanitizedQuery: 'office laptop',
    sawRankedRows: true,
  })),
}));
vi.mock('./search-product-availability', () => ({
  hydrateSearchProductAvailability: vi.fn(async (products: { id: string; price: number }[]) =>
    products.map((product) => ({ product, displayPrice: product.price }))),
}));

describe('semantic fallback after price validation', () => {
  it('fills a price-filtered result even when lexical retrieval filled its raw limit', async () => {
    const query = { eq: vi.fn(() => query), in: vi.fn(async () => ({
      data: [{ id: 'affordable', name: 'Office Laptop', category: 'Laptops', price: 90000 }],
      error: null,
    })) };
    const supabase = { from: vi.fn(() => ({ select: vi.fn(() => query) })) } as unknown as SupabaseClient;
    const semanticSearch = vi.fn(async () => ['affordable']);

    const result = await discoverMcpProducts({
      args: { query: 'office laptop', max_price: 100000, limit: 2 },
      merchantId: 'merchant-1', sanitizeString: (input) => input,
      semanticSearch, supabase,
    });

    expect(semanticSearch).toHaveBeenCalledWith('office laptop');
    expect(result.selectedProducts.map(({ product }) => product.id)).toEqual(['affordable']);
  });
});
