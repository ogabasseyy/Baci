import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadStructuredDiscoveryCandidates } from './load-structured-discovery-candidates';

import { structuredCandidateTestSupport } from './structured-candidate-test-support';

const { setup, ranked, productRows } = structuredCandidateTestSupport;

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
    const pages: number[][] = [];
    const rpc = vi.fn(async (_name: string, args: { p_limit: number; p_offset: number }) => {
      pages.push([args.p_offset, args.p_limit]);
      return { data: rows.slice(args.p_offset, args.p_offset + args.p_limit), error: null };
    });
    const result = await loadStructuredDiscoveryCandidates({
      merchantId: 'merchant-1', supabase: { rpc } as unknown as SupabaseClient,
    });
    expect(result.products).toHaveLength(500);
    expect(result.truncated).toBe(count > 500);
    expect(pages.at(-1)).toEqual([500, 1]);
  });

  it('preserves 500 confirmed browse products when the final cap probe fails', async () => {
    const rows = productRows(Array.from({ length: 500 }, (_, index) => `p-${index}`));
    const pages: number[][] = [];
    const rpc = vi.fn(async (_name: string, args: { p_limit: number; p_offset: number }) => {
      pages.push([args.p_offset, args.p_limit]);
      if (args.p_offset === 500) return { data: null, error: new Error('probe failed') };
      return { data: rows.slice(args.p_offset, args.p_offset + args.p_limit), error: null };
    });

    const result = await loadStructuredDiscoveryCandidates({
      merchantId: 'merchant-1', supabase: { rpc } as unknown as SupabaseClient,
    });

    expect(result.products).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(pages.at(-1)).toEqual([500, 1]);
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
      brand_filter: null, category_filter: null, condition_filter: null, excluded_types_filter: null,
    });
  });

  it('sends the structured fact query to the facts index instead of shopper wording', async () => {
    const fixture = setup({ lexicalPages: [[]], products: [] });
    await loadStructuredDiscoveryCandidates({ query: 'Samsung or Google 256GB under budget',
      factQuery: '(phone & (samsung | google) & 256gb)', merchantId: 'merchant-1', supabase: fixture.supabase });
    expect(fixture.rpc).toHaveBeenCalledWith('search_product_discovery_facts', {
      merchant_id_param: 'merchant-1', query_text: '(phone & (samsung | google) & 256gb)', result_limit: 100, result_offset: 0,
      brand_filter: null, category_filter: null, condition_filter: null, excluded_types_filter: null,
    });
  });

  it('narrows fact retrieval by brand, category and condition before the cap', async () => {
    const fixture = setup({ lexicalPages: [[]], products: [] });
    await loadStructuredDiscoveryCandidates({ factQuery: '(phone)', merchantId: 'merchant-1',
      supabase: fixture.supabase, brand: 'Samsung', category: 'Smartphones', condition: 'used' });
    expect(fixture.rpc).toHaveBeenCalledWith('search_product_discovery_facts', expect.objectContaining({
      brand_filter: 'Samsung', category_filter: 'Smartphones', condition_filter: 'used',
    }));
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
    const rpc = async (_name: string, args: { p_limit: number; p_offset: number }) => {
      if (args.p_offset > 0) throw new Error('page unavailable');
      return { data: rows.slice(args.p_offset, args.p_offset + args.p_limit), error: null };
    };
    const result = await loadStructuredDiscoveryCandidates({merchantId: 'merchant-1', supabase: { rpc } as unknown as SupabaseClient});
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
    const rows = [...productRows(Array.from({ length: 100 }, (_, index) => `p-${index}`)), ...productRows(['last'])];
    const rpc = vi.fn(async (_name: string, args: { p_limit: number; p_offset: number }) => ({
      data: rows.slice(args.p_offset, args.p_offset + args.p_limit), error: null,
    }));

    const result = await loadStructuredDiscoveryCandidates({
      merchantId: 'merchant-2', supabase: { rpc } as unknown as SupabaseClient,
    });

    expect(result.products).toHaveLength(101);
    expect(result.truncated).toBe(false);
    expect(rpc).toHaveBeenCalledWith('search_products_browse', {
      p_merchant_id: 'merchant-2', p_brand: undefined, p_category: undefined,
      p_sort: undefined, p_limit: 100, p_offset: 100,
    });
  });
  it('narrows the browse window with raw brand/category substrings before the cap', async () => {
    const fixture = setup({ lexicalPages: [[]], products: productRows(['p-1']) });
    fixture.rpc.mockImplementation(async (name: string) => ({
      data: name === 'search_products_browse' ? productRows(['p-1']) : [], error: null,
    }));
    const result = await loadStructuredDiscoveryCandidates({
      merchantId: 'merchant-3', supabase: fixture.supabase, brand: 'S%ms_ng', category: 'Phones', condition: 'used',
    });
    expect(result.products).toHaveLength(1);
    // Bound parameters match literally: LIKE wildcards ride raw, no escaping.
    expect(fixture.rpc).toHaveBeenCalledWith('search_products_browse', {
      p_merchant_id: 'merchant-3', p_brand: 'S%ms_ng', p_category: 'Phones',
      p_sort: undefined, p_condition: 'used', p_limit: 100, p_offset: 0,
    });
  });

  it('forwards excluded product types to the browse boundary', async () => {
    const fixture = setup({ lexicalPages: [[]], products: productRows(['p-1']) });
    fixture.rpc.mockImplementation(async (name: string) => ({
      data: name === 'search_products_browse' ? productRows(['p-1']) : [], error: null,
    }));
    await loadStructuredDiscoveryCandidates({
      merchantId: 'merchant-3', supabase: fixture.supabase,
      intent: { alternatives: [{}], excluded_product_types: ['phone'] },
    });
    expect(fixture.rpc).toHaveBeenCalledWith('search_products_browse',
      expect.objectContaining({ p_excluded_types: ['phone'] }));
  });

  it('orders the browse window newest-first before the cap when requested', async () => {
    const newest = setup({ lexicalPages: [[]], products: productRows(['p-1']) });
    await loadStructuredDiscoveryCandidates({
      merchantId: 'merchant-3', supabase: newest.supabase, sort: 'newest',
    });
    expect(newest.rpc).toHaveBeenCalledWith('search_products_browse',
      expect.objectContaining({ p_sort: 'newest' }));
    const stable = setup({ lexicalPages: [[]], products: productRows(['p-1']) });
    await loadStructuredDiscoveryCandidates({ merchantId: 'merchant-3', supabase: stable.supabase });
    expect(stable.rpc).toHaveBeenCalledWith('search_products_browse',
      expect.objectContaining({ p_merchant_id: 'merchant-3' }));
    expect(stable.rpc.mock.calls[0]?.[1]).not.toMatchObject({ p_sort: 'newest' });
  });
});
