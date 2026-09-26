import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadMcpBrowseFacetValues } from './browse-catalog-facets';

describe('loadMcpBrowseFacetValues', () => {
  it('bounds offer lookups for a large catalog', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      id: `offer-${index}`, category: 'Used Phones', brand: 'Samsung',
      manage_stock: true, stock_quantity: 0, has_variants: false, has_condition_offers: true,
    }));
    const query = {
      select: vi.fn(), eq: vi.fn(), or: vi.fn(), ilike: vi.fn(),
      then: (resolve: (value: { data: typeof rows; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.or.mockReturnValue(query);
    query.ilike.mockReturnValue(query);
    const inMock = vi.fn(async (_column: string, ids: string[]) => ({
      data: ids.map((product_id) => ({ product_id, stock_quantity: 0 })), error: null,
    }));
    const offerQuery = { select: vi.fn(), eq: vi.fn(), in: inMock };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    const supabase = {
      from: vi.fn((table: string) => table === 'product_offers' ? offerQuery : query),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    expect(await loadMcpBrowseFacetValues({ supabase, merchantId: 'merchant-1', facet: 'category' }))
      .toEqual([]);
    expect(inMock.mock.calls.length).toBeGreaterThan(1);
    expect(Math.max(...inMock.mock.calls.map(([, ids]) => ids.length))).toBeLessThanOrEqual(100);
  });

  it('includes option-stocked facets and excludes confirmed sold-out options', async () => {
    const rows = [
      { id: 'phone', category: 'Smartphones', brand: 'Redmi', manage_stock: true, stock_quantity: 0, has_variants: true, has_condition_offers: false },
      { id: 'laptop', category: 'Laptops', brand: 'Dell', manage_stock: true, stock_quantity: 0, has_variants: true, has_condition_offers: false },
      { id: 'charger', category: 'Accessories', brand: 'Anker', manage_stock: true, stock_quantity: 3, has_variants: false, has_condition_offers: false },
      { id: 'used-phone', category: 'Used Phones', brand: 'Samsung', manage_stock: true, stock_quantity: 0, has_variants: false, has_condition_offers: true },
    ];
    const query = {
      select: vi.fn(), eq: vi.fn(), or: vi.fn(), ilike: vi.fn(),
      then: (resolve: (value: { data: typeof rows; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.or.mockReturnValue(query);
    query.ilike.mockReturnValue(query);
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [{ product_id: 'used-phone', stock_quantity: 1 }], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    const supabase = {
      from: vi.fn((table: string) => table === 'product_offers' ? offerQuery : query),
      rpc: vi.fn(async () => ({
        data: [
          { product_id: 'phone', attributes: { color: 'Red' }, stock_quantity: 2 },
          { product_id: 'laptop', attributes: { color: 'Black' }, stock_quantity: 0 },
        ], error: null,
      })),
    } as unknown as SupabaseClient;

    expect(await loadMcpBrowseFacetValues({ supabase, merchantId: 'merchant-1', facet: 'category' }))
      .toEqual(['Smartphones', 'Accessories', 'Used Phones']);
    expect(await loadMcpBrowseFacetValues({ supabase, merchantId: 'merchant-1', facet: 'brand' }))
      .toEqual(['Redmi', 'Anker', 'Samsung']);
    expect(offerQuery.in).toHaveBeenCalledWith('product_id', ['used-phone']);
  });
});
