import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadMcpBrowseFacetValues } from './browse-catalog-facets';

describe('loadMcpBrowseFacetValues', () => {
  it('includes option-stocked facets and excludes confirmed sold-out options', async () => {
    const rows = [
      { id: 'phone', category: 'Smartphones', brand: 'Redmi', manage_stock: true, stock_quantity: 0, has_variants: true, has_condition_offers: false },
      { id: 'laptop', category: 'Laptops', brand: 'Dell', manage_stock: true, stock_quantity: 0, has_variants: true, has_condition_offers: false },
      { id: 'charger', category: 'Accessories', brand: 'Anker', manage_stock: true, stock_quantity: 3, has_variants: false, has_condition_offers: false },
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
    const supabase = {
      from: vi.fn(() => query),
      rpc: vi.fn(async () => ({
        data: [
          { product_id: 'phone', attributes: { color: 'Red' }, stock_quantity: 2 },
          { product_id: 'laptop', attributes: { color: 'Black' }, stock_quantity: 0 },
        ], error: null,
      })),
    } as unknown as SupabaseClient;

    expect(await loadMcpBrowseFacetValues({ supabase, merchantId: 'merchant-1', facet: 'category' }))
      .toEqual(['Smartphones', 'Accessories']);
    expect(await loadMcpBrowseFacetValues({ supabase, merchantId: 'merchant-1', facet: 'brand' }))
      .toEqual(['Redmi', 'Anker']);
  });
});
