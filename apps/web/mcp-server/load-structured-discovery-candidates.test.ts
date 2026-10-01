import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadStructuredDiscoveryCandidates } from './load-structured-discovery-candidates';

function setup({ lexicalPages, products, failHydrationCalls = [] }: {
  lexicalPages: unknown[][];
  failHydrationCalls?: number[];
  products: Array<Record<string, unknown>>;
}) {
  let rpcPage = 0;
  const rpc = vi.fn(async (name: string) => ({ data: name === 'search_product_discovery_facts' ? [] : lexicalPages[rpcPage++] ?? [], error: null as Error | null }));
  const queryCalls: Array<{ table: string; calls: unknown[][] }> = [];
  const from = vi.fn((table: string) => {
    const calls: unknown[][] = [];
    queryCalls.push({ table, calls });
    const fail = failHydrationCalls.includes(queryCalls.length);
    const builder = {
      select: vi.fn((...args: unknown[]) => { calls.push(['select', ...args]); return builder; }),
      eq: vi.fn((...args: unknown[]) => { calls.push(['eq', ...args]); return builder; }),
      in: vi.fn((...args: unknown[]) => { calls.push(['in', ...args]); return builder; }),
      order: vi.fn((...args: unknown[]) => { calls.push(['order', ...args]); return builder; }),
      range: vi.fn((...args: unknown[]) => { calls.push(['range', ...args]); return builder; }),
      then: undefined as unknown,
    };
    Object.assign(builder, {
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(fail ? {data: null, error: new Error('batch unavailable')} : { data: products, error: null }).then(resolve),
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
  it('preserves collected semantic candidates when the final coverage probe fails', async () => {
    const ids = Array.from({length: 200}, (_, index) => `s-${index}`);
    const fixture = setup({lexicalPages: [[]], products: productRows(ids)});
    const semanticSearch = async (_query: string, offset: number) => {
      if (offset === 200) throw new Error('probe unavailable');
      return ids.slice(offset, offset + 40);
    };
    const result = await loadStructuredDiscoveryCandidates({
      query: 'camera', merchantId: 'merchant-1', supabase: fixture.supabase, semanticSearch,
    });
    expect(result.products.map(({id}) => id)).toEqual(ids);
    expect(result).toMatchObject({truncated: true, semanticUnavailable: true});
  });

  it.each([200, 201])('checks whether a %s-result semantic scan is actually truncated', async (count) => {
    const ids = Array.from({length: count}, (_, index) => `s-${index}`);
    const fixture = setup({lexicalPages: [[]], products: productRows(ids)});
    const semanticSearch = vi.fn(async (_query: string, offset: number) => ids.slice(offset, offset + 40));
    const result = await loadStructuredDiscoveryCandidates({
      query: 'camera', merchantId: 'merchant-1', supabase: fixture.supabase, semanticSearch,
    });
    expect(result.truncated).toBe(count > 200);
    expect(semanticSearch.mock.calls.at(-1)?.[1]).toBe(200);
  });

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

  it('preserves 500 confirmed browse products when the final cap probe fails', async () => {
    const rows = productRows(Array.from({ length: 500 }, (_, index) => `p-${index}`));
    const ranges: number[][] = [];
    const from = () => {
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder,
        range: (start: number, end: number) => {
          ranges.push([start, end]);
          if (start === 500) return Promise.resolve({ data: null, error: new Error('probe failed') });
          return Promise.resolve({ data: rows.slice(start, end + 1), error: null });
        },
      };
      return builder;
    };

    const result = await loadStructuredDiscoveryCandidates({
      merchantId: 'merchant-1', supabase: { from } as unknown as SupabaseClient,
    });

    expect(result.products).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(ranges.at(-1)).toEqual([500, 500]);
  });

  it('retrieves verified-fact-only matches independently of marketing and embeddings', async () => {
    const fixture = setup({ lexicalPages: [[]], products: productRows(['facts-only']) });
    fixture.rpc.mockImplementation(async (name: string) => ({
      data: name === 'search_product_discovery_facts' ? ranked(['facts-only']) : [], error: null,
    }));
    const result = await loadStructuredDiscoveryCandidates({query: 'ZX-42', merchantId: 'merchant-1', supabase: fixture.supabase});
    expect(result.products.map(({id}) => id)).toEqual(['facts-only']);
    expect(result.truncated).toBe(false);
    expect(fixture.rpc).toHaveBeenCalledWith('search_product_discovery_facts', {
      merchant_id_param: 'merchant-1', query_text: 'ZX-42', result_limit: 100, result_offset: 0,
    });
  });

  it('sends the structured fact query to the facts index instead of shopper wording', async () => {
    const fixture = setup({ lexicalPages: [[]], products: [] });
    await loadStructuredDiscoveryCandidates({ query: 'Samsung or Google 256GB under budget',
      factQuery: 'phone Samsung OR Google 256GB', merchantId: 'merchant-1', supabase: fixture.supabase });
    expect(fixture.rpc).toHaveBeenCalledWith('search_product_discovery_facts', {
      merchant_id_param: 'merchant-1', query_text: 'phone Samsung OR Google 256GB', result_limit: 100, result_offset: 0,
    });
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

  it('marks coverage incomplete when ranked IDs vanish before hydration', async () => {
    const fixture = setup({ lexicalPages: [ranked(['p-1', 'p-2'])], products: productRows(['p-1']) });
    const result = await loadStructuredDiscoveryCandidates({
      query: 'camera', merchantId: 'merchant-1', supabase: fixture.supabase,
    });
    expect(result.products.map(({ id }) => id)).toEqual(['p-1']);
    expect(result.truncated).toBe(true);
  });

  it('runs semantic retrieval even when lexical retrieval fills its first page', async () => {
    const lexicalIds = Array.from({ length: 100 }, (_, index) => `lex-${index}`);
    const { supabase, rpc } = setup({ lexicalPages: [ranked(lexicalIds)], products: [] });
    const semanticSearch = vi.fn(async () => []);

    await loadStructuredDiscoveryCandidates({
      query: 'structured query', merchantId: 'merchant-1', supabase, semanticSearch,
    });

    expect(semanticSearch).toHaveBeenCalledWith('structured query', 0);
    expect(rpc.mock.calls.filter(([name]) => name === 'search_products_v2')).toHaveLength(1);
  });

  it('isolates source failures and preserves independently retrieved candidates', async () => {
    const { supabase } = setup({ lexicalPages: [ranked(['lexical'])], products: productRows(['lexical']) });
    const result = await loadStructuredDiscoveryCandidates({
      query: 'query', merchantId: 'merchant-1', supabase,
      semanticSearch: async () => { throw new Error('embedding lookup failed'); },
    });
    expect(result).toMatchObject({ truncated: true, semanticUnavailable: true });
    expect(result.products.map(({ id }) => id)).toEqual(['lexical']);

    const lexicalError = new Error('lexical RPC failed');
    const fixture = setup({lexicalPages: [], products: productRows(['semantic', 'fact'])});
    fixture.rpc.mockImplementation(async (name: string) => name === 'search_products_v2'
      ? {data: [], error: lexicalError} : {data: ranked(['fact']), error: null});
    const degraded = await loadStructuredDiscoveryCandidates({
      query: 'query', merchantId: 'merchant-1', supabase: fixture.supabase,
      semanticSearch: async () => ['semantic'],
    });
    expect(degraded.products.map(({id}) => id)).toEqual(['fact', 'semantic']);
    expect(degraded.truncated).toBe(true);
  });

  it('preserves semantic pages already fetched when a later page rejects', async () => {
    const ids = Array.from({length: 40}, (_, i) => `s-${i}`);
    const fixture = setup({lexicalPages: [[]], products: productRows(ids)});
    const result = await loadStructuredDiscoveryCandidates({query: 'query', merchantId: 'merchant-1', supabase: fixture.supabase,
      semanticSearch: async (_query, offset) => {if (offset > 0) throw new Error('network failure'); return ids;},
    });
    expect(result.products.map(({id}) => id)).toEqual(ids);
    expect(result).toMatchObject({truncated: true, semanticUnavailable: true});
  });

  it('preserves lexical pages already fetched when a later page rejects', async () => {
    const ids = Array.from({length: 100}, (_, i) => `p-${i}`);
    const fixture = setup({lexicalPages: [], products: productRows(ids)});
    fixture.rpc.mockImplementation(async (name: string, ..._args: unknown[]) => {
      if (name === 'search_product_discovery_facts') return {data: [], error: null};
      if (fixture.rpc.mock.calls.filter(([rpcName]) => rpcName === name).length > 1) throw new Error('network failure');
      return {data: ranked(ids, 200), error: null};
    });
    const result = await loadStructuredDiscoveryCandidates({query: 'query', merchantId: 'merchant-1', supabase: fixture.supabase});
    expect(result.products.map(({id}) => id)).toEqual(ids);
    expect(result.truncated).toBe(true);
  });

  it('retains other confirmed product batches when one hydration batch fails', async () => {
    const ids = Array.from({length: 250}, (_, i) => `p-${i}`);
    const fixture = setup({lexicalPages: [ranked(ids.slice(0,100),250), ranked(ids.slice(100,200),250), ranked(ids.slice(200),250)], products: productRows(ids), failHydrationCalls: [2]});
    const result = await loadStructuredDiscoveryCandidates({query: 'phone', merchantId: 'merchant-1', supabase: fixture.supabase});
    expect(result.products.map(({id}) => id)).toEqual([...ids.slice(0,100), ...ids.slice(200)]);
    expect(result.truncated).toBe(true);
  });

  it('preserves confirmed browse pages after a later page fails', async () => {
    const rows = productRows(Array.from({length: 100}, (_, i) => `p-${i}`));
    const from = () => {
      const builder = { select: () => builder, eq: () => builder, order: () => builder,
        range: async (start: number) => { if (start > 0) throw new Error('page unavailable'); return {data: rows, error: null}; },
      };
      return builder;
    };
    const result = await loadStructuredDiscoveryCandidates({merchantId: 'merchant-1', supabase: {from} as unknown as SupabaseClient});
    expect(result.products).toHaveLength(100);
    expect(result.truncated).toBe(true);
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

    expect(rpc.mock.calls.filter(([name]) => name === 'search_products_v2')).toHaveLength(5);
    expect(semanticSearch.mock.calls.map(([ , offset ]) => offset)).toEqual([0, 40, 80, 120, 160, 200]);
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
  it('does not double-count correlated lexical and combined-document votes', async () => {
    const fixture = setup({ lexicalPages: [ranked(['keyword-stuffed', 'semantic-match'])], products: productRows(['keyword-stuffed', 'semantic-match']) });
    const original = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation(async (name) => name === 'search_product_discovery_facts'
      ? { data: ranked(['keyword-stuffed']), error: null } : original(name));
    const result = await loadStructuredDiscoveryCandidates({ query: 'camera', merchantId: 'merchant-1', supabase: fixture.supabase,
      semanticSearch: async () => ['semantic-match'],
    });
    expect(result.products.map(({id}) => id)).toEqual(['semantic-match', 'keyword-stuffed']);
  });

});
