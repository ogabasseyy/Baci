import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  fetchActiveFeedProducts,
  type RawFeedProductRow,
} from './fetch-active-feed-products';

interface MockPage {
  data?: RawFeedProductRow[] | null;
  error?: unknown;
}

function createProductsSupabase(pages: MockPage[]) {
  let call = 0;
  const calls = { not: 0, is: 0, gt: 0, or: 0, orFilters: [] as string[] };
  const query = {
    eq: () => query,
    not: () => {
      calls.not += 1;
      return query;
    },
    is: () => {
      calls.is += 1;
      return query;
    },
    gt: () => {
      calls.gt += 1;
      return query;
    },
    or: (filter: string) => {
      calls.or += 1;
      calls.orFilters.push(filter);
      return query;
    },
    order: () => query,
    limit: () => query,
    overrideTypes: () => {
      const page = pages[call] ?? { data: [] };
      call += 1;
      return Promise.resolve({
        data: page.data ?? null,
        error: page.error ?? null,
      });
    },
  };
  const supabase = {
    from: (table: string) =>
      table === 'products' ? { select: () => query } : {},
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

const row = (id: string, created_at: string | null): RawFeedProductRow =>
  ({
    id,
    name: id,
    description: id,
    price: 10,
    stock: 1,
    created_at,
  }) as RawFeedProductRow;

describe('fetchActiveFeedProducts', () => {
  it('pages dated rows with the cursor before null-created rows', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) =>
      row(
        `p${index}`,
        index === 999 ? '2026-01-05T00:00:00Z' : '2026-02-01T00:00:00Z'
      )
    );
    const { supabase, calls } = createProductsSupabase([
      { data: fullPage },
      { data: [row('a', '2026-01-02'), row('b', '2026-01-01')] },
      { data: [row('c', null)] },
    ]);

    const products = await fetchActiveFeedProducts(supabase, 'm1');

    expect(products).toHaveLength(1003);
    expect(products[999].id).toBe('p999');
    expect(products.slice(1000).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    // The second dated page carries the cursor from the full first page.
    expect(calls.or).toBe(1);
    expect(calls.orFilters).toEqual([
      'created_at.lt.2026-01-05T00:00:00Z,and(created_at.eq.2026-01-05T00:00:00Z,id.gt.p999)',
    ]);
    expect(calls.not).toBe(2);
    expect(calls.is).toBe(1);
  });

  it('returns an empty list when no products exist', async () => {
    const { supabase } = createProductsSupabase([{ data: [] }, { data: [] }]);

    await expect(fetchActiveFeedProducts(supabase, 'm1')).resolves.toEqual([]);
  });

  it('throws when the products query fails', async () => {
    const { supabase } = createProductsSupabase([
      { error: { message: 'db down' } },
    ]);

    await expect(fetchActiveFeedProducts(supabase, 'm1')).rejects.toThrow(
      'Failed to fetch products'
    );
  });
});
