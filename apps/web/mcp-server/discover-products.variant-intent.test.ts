import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { discoverMcpProducts } from './discover-products';

function client(ranked: boolean, tracked = true, description?: string, name = 'iPhone 15') {
  const product = { id: 'iphone', name, category: 'Smartphones',
    brand: 'Apple', price: 100000, has_variants: true, manage_stock: tracked, description };
  const variants = [
    { product_id: 'iphone', attributes: { storage: '256GB', color: 'Blue' }, stock_quantity: 2 },
    { product_id: 'iphone', attributes: { storage: '512GB', color: 'Red' }, stock_quantity: 0 },
  ];
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(async () => ({ data: [product], error: null })),
  };
  const supabase = {
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
    rpc: vi.fn(async (name: string) => ({ data: name === 'search_products_v2'
      ? ranked ? [{ product_id: 'iphone', total_count: 1 }] : []
      : variants, error: null })),
  } as unknown as SupabaseClient;
  return supabase;
}

describe('discovery variant intent', () => {
  it.each([true, false])('matches available capacity and color on ranked=%s', async (ranked) => {
    const supabase = client(ranked);
    const result = await discoverMcpProducts({
      args: { query: 'iPhone 15 256GB blue', limit: 1 }, merchantId: 'merchant',
      sanitizeString: (value) => value, supabase,
      semanticSearch: ranked ? undefined : async () => ['iphone'],
    });
    expect(result.selectedProducts.map(({ product }) => product.id)).toEqual(['iphone']);
    expect(vi.mocked(supabase.rpc).mock.calls.filter(([name]) => name === 'get_storefront_product_variants')).toHaveLength(1);
  });

  it.each(['iPhone 15 512GB', 'iPhone 15 256GB red'])('rejects unavailable or mixed combination: %s', async (query) => {
    const result = await discoverMcpProducts({
      args: { query }, merchantId: 'merchant', sanitizeString: (value) => value,
      supabase: client(true),
    });
    expect(result.selectedProducts).toEqual([]);
  });

  it('keeps zero-quantity variants eligible when stock is unmanaged', async () => {
    const result = await discoverMcpProducts({
      args: { query: 'iPhone 15 512GB red' }, merchantId: 'merchant',
      sanitizeString: (value) => value, supabase: client(true, false),
    });
    expect(result.selectedProducts.map(({ product }) => product.id)).toEqual(['iphone']);
  });

  it('does not borrow unavailable options advertised by the parent', async () => {
    const result = await discoverMcpProducts({
      args: { query: 'iPhone 15 512GB red' }, merchantId: 'merchant',
      sanitizeString: (value) => value,
      supabase: client(true, true, 'Available in 256GB blue and 512GB red'),
    });
    expect(result.selectedProducts).toEqual([]);
  });

  it('keeps invariant features while removing option claims from name and description', async () => {
    const supabase = client(true, true, 'Touchscreen. 256GB blue and 512GB red', 'iPhone 15 512GB Red');
    const input = { merchantId: 'merchant', sanitizeString: (value: string) => value, supabase };
    const available = await discoverMcpProducts({ ...input, args: { query: 'iPhone 15 256GB blue with touchscreen' } });
    expect(available.selectedProducts.map(({ product }) => product.id)).toEqual(['iphone']);
    const unavailable = await discoverMcpProducts({ ...input, args: { query: 'iPhone 15 512GB red with touchscreen' } });
    expect(unavailable.selectedProducts).toEqual([]);
  });
});
