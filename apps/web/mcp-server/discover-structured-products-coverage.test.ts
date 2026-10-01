import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { discoverStructuredProducts } from './discover-structured-products';

type Fixture = {
  products: Array<Record<string, unknown>>;
  lexicalIds?: string[];
  factIds?: string[];
  lexicalTotal?: number;
  variants?: Array<Record<string, unknown>>;
  offers?: Array<Record<string, unknown>>;
  lexicalError?: Error;
  variantError?: Error;
  offerError?: Error;
};

function client(fixture: Fixture) {
  let lexicalCalls = 0;
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'search_product_discovery_facts') return { data: (fixture.factIds ?? []).map(product_id => ({product_id, total_count: fixture.factIds?.length})), error: null };
    if (name === 'search_products_v2') {
      if (fixture.lexicalError) return { data: null, error: fixture.lexicalError };
      const offset = Number(args?.result_offset ?? 0);
      const ids = fixture.lexicalIds ?? fixture.products.map(({ id }) => String(id));
      const page = ids.slice(offset, offset + 100);
      lexicalCalls += 1;
      return {
        data: page.map((product_id) => ({ product_id, total_count: fixture.lexicalTotal ?? ids.length })),
        error: null,
      };
    }
    if (name === 'get_storefront_product_variants') {
      if (fixture.variantError) return { data: null, error: fixture.variantError };
      const ids = args?.p_product_ids as string[];
      return { data: (fixture.variants ?? []).filter((row) => ids.includes(String(row.product_id))), error: null };
    }
    return { data: null, error: new Error(`Unexpected RPC ${name}`) };
  });

  const from = vi.fn((table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let range: [number, number] | undefined;
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => { filters.push(['eq', column, value]); return builder; }),
      in: vi.fn((column: string, value: unknown) => { filters.push(['in', column, value]); return builder; }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => {range = [start, end]; return builder;}),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (table === 'product_offers' && fixture.offerError) return Promise.resolve({ data: null, error: fixture.offerError }).then(resolve, reject);
        let rows = table === 'products' ? fixture.products : fixture.offers ?? [];
        for (const [kind, column, value] of filters) {
          if (kind === 'eq') rows = rows.filter((row) => row[column] === value);
          if (kind === 'in' && Array.isArray(value)) rows = rows.filter((row) => value.includes(row[column]));
        }
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  });

  return {
    supabase: { rpc, from } as unknown as SupabaseClient,
    rpc,
    from,
    lexicalCalls: () => lexicalCalls,
  };
}

function product(id: string, metadata: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  return {
    id,
    merchant_id: 'merchant-1',
    status: 'active',
    name: id,
    slug: id,
    category: 'Accessories',
    brand: null,
    condition: 'new',
    price: 100,
    compare_at_price: null,
    manage_stock: false,
    stock_quantity: 0,
    has_variants: false,
    has_condition_offers: false,
    discovery_metadata: metadata,
    ...extras,
  };
}

const intent = (...alternatives: McpDiscoveryIntent['alternatives']): McpDiscoveryIntent => ({ alternatives });
const input = (supabase: SupabaseClient, discoveryIntent: McpDiscoveryIntent, overrides: Partial<Parameters<typeof discoverStructuredProducts>[0]> = {}) => ({
  intent: discoveryIntent,
  query: 'Could you help me find something that fits?',
  args: {},
  merchantId: 'merchant-1',
  supabase,
  ...overrides,
});

describe('discoverStructuredProducts', () => {
  it.each([
    ['Samsung or Google 256GB under budget', { product_type: 'phone', brands: ['Samsung', 'Google'], attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }] }, { product_type: 'phone', attributes: { storage_gb: 256 } }, { brand: 'Samsung', category: 'Smartphones' }],
    ['security_camera under Accessories', { product_type: 'security_camera' }, { product_type: 'security_camera' }, { category: 'Accessories' }],
    ['fragrance_diffuser', { product_type: 'fragrance_diffuser' }, { product_type: 'fragrance_diffuser' }, {}],
  ])('matches canonical holdout intent for %s', async (_request, alternative, metadata, extras) => {
    const holdoutProduct = product('holdout', metadata, extras);
    const fixture = client({ products: [holdoutProduct] });
    const result = await discoverStructuredProducts(input(
      fixture.supabase,
      intent(alternative as McpDiscoveryIntent['alternatives'][number]),
      { query: String(_request), args: { ...(String(_request).includes('budget') ? { max_price: 500 } : {}), category: String(_request).includes('Accessories') ? 'Accessories' : undefined } }
    ));
    expect(result.selectedProducts.map(({ product: selected }) => selected.id)).toEqual(['holdout']);
  });
  it.each(['camera', undefined])('marks truncated newest searches incomplete for query %s', async (query) => {
    const ids = Array.from({length: 501}, (_, i) => `p-${i}`);
    const fixture = client({products: ids.map(id => product(id, {})), lexicalIds: ids.slice(0,500), lexicalTotal: 501});
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({}), {query, args: {sort: 'newest'}}));
    expect(result).toMatchObject({priceScanComplete: false, coverage: 'partial', incompleteReason: 'candidate_limit'});
  });

  it('marks a truncated price-sorted structured search incomplete', async () => {
    const ids = Array.from({ length: 500 }, (_, index) => `p-${index}`);
    const fixture = client({ products: ids.map((id) => product(id, { product_type: 'security_camera' })), lexicalIds: ids, lexicalTotal: 501 });
    const result = await discoverStructuredProducts(input(fixture.supabase,
      intent({ product_type: 'security_camera' }), { query: 'camera', args: { sort: 'price_asc', limit: 2 } }));
    expect(result).toMatchObject({ priceScanComplete: false, coverage: 'partial', incompleteReason: 'candidate_limit' });
  });

  it.each(['variant', 'offer'])('marks failed %s hydration incomplete instead of claiming no match', async (source) => {
    const p = product('options', { product_type: 'phone' }, {
      manage_stock: true, stock_quantity: 0, has_variants: source === 'variant', has_condition_offers: source === 'offer',
    });
    const fixture = client({ products: [p], variantError: source === 'variant' ? new Error('offline') : undefined,
      offerError: source === 'offer' ? new Error('offline') : undefined });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({ product_type: 'phone' })));
    expect(result).toMatchObject({ priceScanComplete: false, coverage: 'partial', incompleteReason: 'option_lookup_failed' });
  });

  it.each(['product_type', 'model', 'attributes', 'exclusion'])('discloses partial coverage for missing %s facts', async (constraint) => {
    const p = product('unverified', {}, { category: 'Accessories' });
    const fixture = client({ products: [p] });
    const request = constraint === 'exclusion'
      ? { alternatives: [{}], excluded_product_types: ['charger'] }
      : intent(constraint === 'attributes'
        ? { attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }] }
        : { [constraint]: constraint === 'model' ? 'ZX42' : 'security_camera' });
    const result = await discoverStructuredProducts(input(fixture.supabase, request as McpDiscoveryIntent));
    expect(result.selectedProducts).toEqual([]);
    expect(result.coverage).toBe('partial');
  });
});
