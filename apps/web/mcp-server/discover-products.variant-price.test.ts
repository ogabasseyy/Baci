import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { discoverMcpProducts } from './discover-products';

it.each([true, false])('uses matching option prices for ranked=%s and budget filtering', async (ranked) => {
  const product = { id: 'phone', name: 'iPhone 15', category: 'Smartphones', price: 100, has_variants: true, manage_stock: false };
  const variants = [
    { product_id: 'phone', price_override: 100, attributes: { storage: '128GB', color: 'Red' }, stock_quantity: 0 },
    { product_id: 'phone', price_override: 200, attributes: { storage: '256GB', color: 'Blue' }, stock_quantity: 0 },
  ];
  const query = { eq: vi.fn(() => query), in: vi.fn(async () => ({ data: [product], error: null })) };
  const supabase = { from: vi.fn(() => ({ select: vi.fn(() => query) })),
    rpc: vi.fn(async (name: string) => ({ data: name === 'search_products_v2'
      ? ranked ? [{ product_id: 'phone', total_count: 1 }] : [] : variants, error: null })),
  } as unknown as SupabaseClient;
  const input = { merchantId: 'merchant', supabase, sanitizeString: (value: string) => value,
    semanticSearch: ranked ? undefined : async () => ['phone'] };
  const selected = await discoverMcpProducts({ ...input, args: { query: 'iPhone 15 256GB' } });
  expect(selected.selectedProducts[0]?.displayPrice).toBe(200);
  const budget = await discoverMcpProducts({ ...input, args: { query: 'iPhone 15 256GB', max_price: 150 } });
  expect(budget.selectedProducts).toEqual([]);
});
