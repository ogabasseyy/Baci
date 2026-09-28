import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_POST_FILTER_RESULT_PAGES,
  POST_FILTER_RESULT_PAGE_SIZE,
} from './search-products-ranking';
import { loadMcpSearchProducts } from './search-products-query';

function createRankedSearchSupabase(
  category?: string,
  nameForId?: (id: string) => string,
  descriptionForId?: (id: string) => string
) {
  const inMock = vi.fn(async (_column: string, productIds: string[]) => ({
    data: productIds.map((id) => ({
      brand: 'Samsung',
      category,
      description: descriptionForId?.(id),
      id,
      name: nameForId?.(id) ?? `Product ${id}`,
    })),
    error: null,
  }));
  const query = {
    eq: vi.fn(() => query),
    in: inMock,
  };
  const select = vi.fn(() => query);
  const rpc = vi.fn(
    async (_functionName: string, args: { result_limit?: number; result_offset?: number }) => {
      const offset = args.result_offset ?? 0;
      const rows = Array.from(
        { length: args.result_limit ?? POST_FILTER_RESULT_PAGE_SIZE },
        (_, index) => ({
          product_id: `ranked-${offset + index}`,
          total_count: 10_000,
        })
      );

      return { data: rows, error: null };
    }
  );

  return {
    rpc,
    select,
    supabase: {
      from: vi.fn(() => ({ select })),
      rpc,
    } as unknown as SupabaseClient,
  };
}

function createCatalogSearchSupabase(rowCount = POST_FILTER_RESULT_PAGE_SIZE) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    condition: 'new',
    has_condition_offers: false,
    id: `catalog-${index}`,
    name: `Catalog ${index}`,
  }));
  const range = vi.fn(async (start: number, end: number) => ({
    data: rows.slice(start, end + 1),
    error: null,
  }));
  const query = {
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    ilike: vi.fn(() => query),
    lte: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    range,
  };
  const select = vi.fn(() => query);

  return {
    gte: query.gte,
    lte: query.lte,
    order: query.order,
    range,
    select,
    supabase: {
      from: vi.fn(() => ({ select })),
    } as unknown as SupabaseClient,
  };
}

describe('loadMcpSearchProducts', () => {
  it('selects descriptions and retains a description-only whole-word match', async () => {
    const { select, supabase } = createRankedSearchSupabase(
      'Accessories', () => 'Aroma Machine', () => 'Fragrance diffuser for rooms'
    );
    const result = await loadMcpSearchProducts({
      args: { query: 'diffuser', limit: 1 }, merchantId: 'merchant-1',
      sanitizeString: (input) => input, supabase,
    });
    expect(select).toHaveBeenCalledWith(expect.stringContaining('description'));
    expect(result.products[0]?.name).toBe('Aroma Machine');
  });

  it('drops description-only matches for a broad use-case word', async () => {
    const { supabase } = createRankedSearchSupabase(
      'Furniture', () => 'Ergonomic Chair', () => 'Perfect for work and study'
    );
    const result = await loadMcpSearchProducts({
      args: { query: 'work', limit: 1 }, merchantId: 'merchant-1',
      sanitizeString: (input) => input, supabase,
    });
    expect(result.products).toEqual([]);
  });

  it('filters a punctuated one-word query like its unpunctuated form', async () => {
    const { rpc, supabase } = createRankedSearchSupabase('Accessories', (id) =>
      id === 'ranked-150' ? 'Work Laptop' : 'DreamWorks Dragons Toy'
    );
    const result = await loadMcpSearchProducts({
      args: { query: 'work?', limit: 1 }, merchantId: 'merchant-1',
      sanitizeString: (input) => input, supabase,
    });
    expect(result.products.map((product) => product.name)).toEqual(['Work Laptop']);
    expect(rpc.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      result_limit: POST_FILTER_RESULT_PAGE_SIZE,
    }));
  });

  it('skips a DreamWorks substring match and scans for a whole-word work product', async () => {
    const { rpc, supabase } = createRankedSearchSupabase('Accessories', (id) =>
      id === 'ranked-150' ? 'Work Laptop' : 'DreamWorks Dragons Toy'
    );
    const result = await loadMcpSearchProducts({
      args: { query: 'work', limit: 1 },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });
    expect(result.products.map((product) => product.name)).toEqual(['Work Laptop']);
    expect(rpc.mock.calls.length).toBeGreaterThan(1);
    expect(rpc.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      result_limit: POST_FILTER_RESULT_PAGE_SIZE,
      result_offset: 0,
    }));
  });

  it('loads a bounded ranked candidate pool without parent-price filters or ordering', async () => {
    const { rpc, supabase } = createRankedSearchSupabase('Smartphones');
    const result = await loadMcpSearchProducts({
      args: { limit: 2, max_price: 100, min_price: 50, query: 'phone', sort: 'price_asc' },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });

    expect(result.limit).toBe(2);
    expect(result.products).toHaveLength(MAX_POST_FILTER_RESULT_PAGES * POST_FILTER_RESULT_PAGE_SIZE);
    expect(result.priceScanComplete).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(MAX_POST_FILTER_RESULT_PAGES);
    expect(rpc.mock.calls.map(([, args]) => args)).toEqual(
      Array.from({ length: MAX_POST_FILTER_RESULT_PAGES }, (_, index) => expect.objectContaining({
        max_price_filter: null,
        min_price_filter: null,
        result_limit: POST_FILTER_RESULT_PAGE_SIZE,
        result_offset: index * POST_FILTER_RESULT_PAGE_SIZE,
        sort_by: 'relevance',
      }))
    );
  });

  it('loads a bounded catalog candidate pool without parent-price filters or ordering', async () => {
    const { gte, lte, order, range, supabase } = createCatalogSearchSupabase(600);
    const result = await loadMcpSearchProducts({
      args: { limit: 2, max_price: 100, min_price: 50, sort: 'price_desc' },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });

    expect(result.limit).toBe(2);
    expect(result.products).toHaveLength(MAX_POST_FILTER_RESULT_PAGES * POST_FILTER_RESULT_PAGE_SIZE);
    expect(result.priceScanComplete).toBe(false);
    expect(gte).not.toHaveBeenCalled();
    expect(lte).not.toHaveBeenCalled();
    expect(order.mock.calls.some(([column]) => column === 'price')).toBe(false);
    expect(order.mock.calls.at(-1)).toEqual(['id', { ascending: true }]);
    expect(range).toHaveBeenCalledTimes(MAX_POST_FILTER_RESULT_PAGES + 1);
    expect(range.mock.calls.at(-1)).toEqual([
      MAX_POST_FILTER_RESULT_PAGES * POST_FILTER_RESULT_PAGE_SIZE,
      MAX_POST_FILTER_RESULT_PAGES * POST_FILTER_RESULT_PAGE_SIZE,
    ]);
  });

  it('keeps tablet matches out of an explicit phone search', async () => {
    const { supabase } = createRankedSearchSupabase('Tablets');
    const result = await loadMcpSearchProducts({
      args: { query: 'Redmi phones', limit: 2 },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });

    expect(result.products).toEqual([]);
    expect(result.priceScanComplete).toBe(true);
  });

  it.each([
    'show me some phones',
    'show me the iPhone 15',
    'I need a phone',
    'Android phones',
    'show me Android phones',
    '5G phones',
    'show me 5G phones',
    'phones under 500k',
    'iPhone 15 under ₦500k',
    'Samsung Galaxy S24 phone',
    'Samsung Galaxy Z Fold 7 phone',
    'Google Pixel Fold phone',
    'Samsung Galaxy S24 Ultra phone',
    'Google Pixel 9 Pro phone',
    'Apple iPhone 15 Pro Max 256GB mobile phone',
  ])(
    'keeps non-phone matches out of the handset request %s',
    async (query) => {
      const { supabase } = createRankedSearchSupabase('Accessories');
      const result = await loadMcpSearchProducts({
        args: { query, limit: 2 },
        merchantId: 'merchant-1',
        sanitizeString: (input) => input,
        supabase,
      });

      expect(result.products).toEqual([]);
    }
  );

  it('keeps mixed phone and tablet searches open to both categories', async () => {
    const { supabase } = createRankedSearchSupabase('Tablets');
    const result = await loadMcpSearchProducts({
      args: { query: 'phones and tablets', limit: 2 },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });

    expect(result.products).toHaveLength(2);
  });

  it('does not force phone accessories into the Smartphones category', async () => {
    for (const query of ['phone screen protector', 'phone stand', 'phone mount', 'phone holder', 'phone tripod', 'iPhone 15 stand', 'iPhone 15 holder', 'iPhone 15 lens', 'iPhone 15 pouch', 'iPhone 15 wallet', 'iPhone 15 earbuds', 'case for iPhone 15', 'case for Samsung Galaxy Z Fold 7 phone', 'case for Google Pixel Fold phone', 'charger for phone', 'case iPhone 15', 'charger phone', 'screen protector iPhone 15']) {
      const { supabase } = createRankedSearchSupabase('Accessories');
      const result = await loadMcpSearchProducts({
        args: { query, limit: 2 },
        merchantId: 'merchant-1',
        sanitizeString: (input) => input,
        supabase,
      });
      expect(result.products).toHaveLength(2);
    }
  });

  it('caps ranked post-filter pagination when hydrated rows keep failing filters', async () => {
    const { rpc, select, supabase } = createRankedSearchSupabase();

    const result = await loadMcpSearchProducts({
      args: { brand: 'Apple', limit: 20, query: 'phone' },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });

    expect(result.products).toEqual([]);
    expect(select).toHaveBeenCalledWith(expect.stringContaining('manage_stock'));
    expect(rpc).toHaveBeenCalledTimes(MAX_POST_FILTER_RESULT_PAGES);
    expect(rpc.mock.calls.map(([, args]) => args.result_offset)).toEqual(
      Array.from(
        { length: MAX_POST_FILTER_RESULT_PAGES },
        (_, index) => index * POST_FILTER_RESULT_PAGE_SIZE
      )
    );
  });

  it('caps catalog condition-family pagination when pages keep failing hydration filters', async () => {
    const { range, select, supabase } = createCatalogSearchSupabase(
      MAX_POST_FILTER_RESULT_PAGES * POST_FILTER_RESULT_PAGE_SIZE
    );

    const result = await loadMcpSearchProducts({
      args: { condition: 'used', limit: 20 },
      merchantId: 'merchant-1',
      sanitizeString: (input) => input,
      supabase,
    });

    expect(result.products).toEqual([]);
    expect(select).toHaveBeenCalledWith(expect.stringContaining('manage_stock'));
    expect(range).toHaveBeenCalledTimes(MAX_POST_FILTER_RESULT_PAGES);
    expect(range.mock.calls).toEqual(
      Array.from({ length: MAX_POST_FILTER_RESULT_PAGES }, (_, index) => {
        const offset = index * POST_FILTER_RESULT_PAGE_SIZE;
        return [offset, offset + POST_FILTER_RESULT_PAGE_SIZE - 1];
      })
    );
  });
});
