import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { discoverMcpProducts } from './discover-products';

it.each(['HP', 'LG'])('guards ranked and semantic %s searches with a category', async (brand) => {
  const products = [
    { id: 'wanted', name: `${brand} Laptop`, brand, category: 'Laptops', price: 100, manage_stock: false },
    { id: 'other', name: 'Dell Laptop', brand: 'Dell', category: 'Laptops', price: 100, manage_stock: false,
      description: `Compatible with ${brand} accessories` },
  ];
  for (const ranked of [true, false]) {
    const query = { eq: vi.fn(() => query), in: vi.fn(async (_column: string, ids: string[]) => ({
      data: products.filter((product) => ids.includes(product.id)), error: null,
    })) };
    const supabase = { from: vi.fn(() => ({ select: vi.fn(() => query) })),
      rpc: vi.fn(async () => ({ data: ranked ? products.map((product) => ({ product_id: product.id, total_count: 2 })) : [], error: null })),
    } as unknown as SupabaseClient;
    const result = await discoverMcpProducts({ args: { query: brand, category: 'Laptops', limit: 2 },
      merchantId: 'merchant', sanitizeString: (value) => value, supabase,
      semanticSearch: async () => products.map((product) => product.id),
    });
    expect(result.selectedProducts.map(({ product }) => product.id)).toEqual(['wanted']);
  }
});
