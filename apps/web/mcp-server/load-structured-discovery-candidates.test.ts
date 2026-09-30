import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadStructuredDiscoveryCandidates } from './load-structured-discovery-candidates';

function setup({ lexicalPages, products }: {
  lexicalPages: unknown[][];
  products: Array<Record<string, unknown>>;
}) {
  let rpcPage = 0;
  const rpc = vi.fn(async () => ({ data: lexicalPages[rpcPage++] ?? [], error: null }));
  const queryCalls: Array<{ table: string; calls: unknown[][] }> = [];
  const from = vi.fn((table: string) => {
    const calls: unknown[][] = [];
    queryCalls.push({ table, calls });
    const builder = {
      select: vi.fn((...args: unknown[]) => { calls.push(['select', ...args]); return builder; }),
      eq: vi.fn((...args: unknown[]) => { calls.push(['eq', ...args]); return builder; }),
      in: vi.fn((...args: unknown[]) => { calls.push(['in', ...args]); return builder; }),
      order: vi.fn((...args: unknown[]) => { calls.push(['order', ...args]); return builder; }),
      range: vi.fn((...args: unknown[]) => { calls.push(['range', ...args]); return builder; }),
      then: undefined as unknown,
    };
    Object.assign(builder, {
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: products, error: null }).then(resolve),
    });
    return builder;
  });
  return {
    supabase: { rpc, from } as unknown as SupabaseClient,
    rpc,
    from,
    queryCalls,
  };
}

const ranked = (ids: string[], total = ids.length) => ids.map((product_id) => ({ product_id, total_count: total }));
const productRows = (ids: string[]) => ids.map((id) => ({ id, name: id }));

describe('loadStructuredDiscoveryCandidates', () => {
  it.each([500, 501])('distinguishes an exact-cap %s-product catalog from truncation', async (count) => {
    const rows = productRows(Array.from({length: count}, (_, index) => `p-${index}`));
    const ranges: number[][] = [];
    const from = () => {
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder,
        range: (start: number, end: number) => {
          ranges.push([start, end]);
          return Promise.resolve({data: rows.slice(start, end + 1), error: null});
        },
      };
      return builder;
    };
    const result = await loadStructuredDiscoveryCandidates({
      merchantId: 'merchant-1', supabase: {from} as unknown as SupabaseClient,
    });
    expect(result.products).toHaveLength(500);
    expect(result.truncated).toBe(count > 500);
    expect(ranges.at(-1)).toEqual([500, 500]);
  });

  it('fuses overlapping lexical and semantic candidates and hydrates in fusion order', async () => {
    const { supabase } = setup({
      lexicalPages: [ranked(['lexical-first', 'overlap', 'lexical-third'])],
      products: productRows(['lexical-third', 'semantic-only', 'overlap', 'lexical-first']),
    });
    const semanticSearch = vi.fn(async () => ['semantic-only', 'overlap']);

    const result = await loadStructuredDiscoveryCandidates({
      query: 'phone with good camera', merchantId: 'merchant-1', supabase, semanticSearch,
    });

    expect(result.products.map(({ id }) => id)).toEqual([
      'overlap', 'lexical-first', 'semantic-only', 'lexical-third',
    ]);
    expect(result).toMatchObject({ truncated: false, semanticUnavailable: false });
  });

  it('runs semantic retrieval even when lexical retrieval fills its first page', async () => {
    const lexicalIds = Array.from({ length: 100 }, (_, index) => `lex-${index}`);
    const { supabase, rpc } = setup({ lexicalPages: [ranked(lexicalIds)], products: [] });
    const semanticSearch = vi.fn(async () => []);

    await loadStructuredDiscoveryCandidates({
      query: 'structured query', merchantId: 'merchant-1', supabase, semanticSearch,
    });

    expect(semanticSearch).toHaveBeenCalledWith('structured query', 0);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('isolates semantic errors while propagating lexical errors', async () => {
    const { supabase } = setup({ lexicalPages: [ranked(['lexical'])], products: productRows(['lexical']) });
    const result = await loadStructuredDiscoveryCandidates({
      query: 'query', merchantId: 'merchant-1', supabase,
      semanticSearch: async () => { throw new Error('embedding lookup failed'); },
    });
    expect(result.semanticUnavailable).toBe(true);
    expect(result.products.map(({ id }) => id)).toEqual(['lexical']);

    const lexicalError = new Error('lexical RPC failed');
    const broken = { rpc: async () => ({ data: null, error: lexicalError }) } as unknown as SupabaseClient;
    await expect(loadStructuredDiscoveryCandidates({
      query: 'query', merchantId: 'merchant-1', supabase: broken,
      semanticSearch: async () => [],
    })).rejects.toBe(lexicalError);
  });

  it('scopes hydration to the requested merchant and active products', async () => {
    const { supabase, queryCalls } = setup({
      lexicalPages: [ranked(['wanted', 'wrong-merchant', 'inactive'])],
      products: productRows(['wanted']),
    });
    await loadStructuredDiscoveryCandidates({ query: 'query', merchantId: 'merchant-7', supabase });

    expect(queryCalls[0]?.calls).toContainEqual(['eq', 'merchant_id', 'merchant-7']);
    expect(queryCalls[0]?.calls).toContainEqual(['eq', 'status', 'active']);
  });

  it('bounds lexical and semantic scans and marks incomplete candidate pools', async () => {
    const lexicalPages = Array.from({ length: 5 }, (_, page) =>
      ranked(Array.from({ length: 100 }, (_, index) => `l-${page * 100 + index}`), 700)
    );
    const { supabase, rpc } = setup({ lexicalPages, products: [] });
    const semanticSearch = vi.fn(async (_query: string, offset: number) =>
      Array.from({ length: 40 }, (_, index) => `s-${offset + index}`)
    );

    const result = await loadStructuredDiscoveryCandidates({
      query: 'query', merchantId: 'merchant-1', supabase, semanticSearch,
    });

    expect(rpc).toHaveBeenCalledTimes(5);
    expect(semanticSearch.mock.calls.map(([ , offset ]) => offset)).toEqual([0, 40, 80, 120, 160]);
    expect(result.truncated).toBe(true);
  });

  it('browses active merchant products with bounded stable pages when query is absent', async () => {
    const pages = [productRows(Array.from({ length: 100 }, (_, index) => `p-${index}`)), productRows(['last'])];
    let page = 0;
    const calls: unknown[][] = [];
    const from = vi.fn(() => {
      const current = page++;
      const builder = {
        select: vi.fn((...args: unknown[]) => { calls.push(['select', ...args]); return builder; }),
        eq: vi.fn((...args: unknown[]) => { calls.push(['eq', ...args]); return builder; }),
        order: vi.fn((...args: unknown[]) => { calls.push(['order', ...args]); return builder; }),
        range: vi.fn((...args: unknown[]) => {
          calls.push(['range', ...args]);
          return Promise.resolve({ data: pages[current], error: null });
        }),
      };
      return builder;
    });

    const result = await loadStructuredDiscoveryCandidates({
      merchantId: 'merchant-2', supabase: { from } as unknown as SupabaseClient,
    });

    expect(result.products).toHaveLength(101);
    expect(result.truncated).toBe(false);
    expect(calls).toContainEqual(['eq', 'merchant_id', 'merchant-2']);
    expect(calls).toContainEqual(['eq', 'status', 'active']);
    expect(calls).toContainEqual(['range', 100, 199]);
  });
});
