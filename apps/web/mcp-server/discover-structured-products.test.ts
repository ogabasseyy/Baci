import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { discoverStructuredProducts } from './discover-structured-products';

type Fixture = {
  products: Array<Record<string, unknown>>;
  lexicalIds?: string[];
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
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => { filters.push(['eq', column, value]); return builder; }),
      in: vi.fn((column: string, value: unknown) => { filters.push(['in', column, value]); return builder; }),
      order: vi.fn(() => builder),
      range: vi.fn(() => builder),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (table === 'product_offers' && fixture.offerError) return Promise.resolve({ data: null, error: fixture.offerError }).then(resolve, reject);
        let rows = table === 'products' ? fixture.products : fixture.offers ?? [];
        for (const [kind, column, value] of filters) {
          if (kind === 'eq') rows = rows.filter((row) => row[column] === value);
          if (kind === 'in' && Array.isArray(value)) rows = rows.filter((row) => value.includes(row[column]));
        }
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
  it('merges independent lexical and semantic retrieval and bypasses sentence grammar', async () => {
    const wiredCharger = product('wired-charger', {
      product_type: 'charger', compatible_with: ['iPhone'], attributes: { power_w: 30 },
    }, { brand: 'Apple' });
    const wirelessCharger = product('wireless-charger', {
      product_type: 'charger', compatible_with: ['iPhone'], attributes: { power_w: 25 },
    }, { brand: 'Apple' });
    const fixture = client({ products: [wiredCharger, wirelessCharger], lexicalIds: ['wired-charger'] });
    const semanticSearch = vi.fn(async () => ['wireless-charger']);
    const result = await discoverStructuredProducts(input(
      fixture.supabase,
      intent({ product_type: 'charger', brands: ['Apple'], compatible_with: 'iPhone' }),
      { semanticSearch }
    ));

    expect(result.selectedProducts.map(({ product: selected }) => selected.id)).toEqual(['wired-charger', 'wireless-charger']);
    expect(semanticSearch).toHaveBeenCalledWith('Could you help me find something that fits?', 0);
    expect(fixture.rpc).toHaveBeenCalledWith('search_products_v2', expect.any(Object));
  });

  it('requires the same purchasable option to satisfy attributes and the price ceiling', async () => {
    const phone = product('phone', { product_type: 'phone' }, {
      brand: 'Samsung', category: 'Smartphones', has_variants: true,
    });
    const fixture = client({
      products: [phone],
      variants: [
        { product_id: 'phone', attributes: { storage: '128GB' }, price_override: 100, stock_quantity: 0 },
        { product_id: 'phone', attributes: { storage: '256GB' }, price_override: 200, stock_quantity: 0 },
      ],
    });
    const result = await discoverStructuredProducts(input(
      fixture.supabase,
      intent({ product_type: 'phone', brands: ['Samsung'], attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }] }),
      { args: { max_price: 150 } }
    ));

    expect(result.selectedProducts).toEqual([]);
  });

  it('uses condition-specific offers instead of substituting the base condition', async () => {
    const laptop = product('laptop', { product_type: 'laptop', attributes: { ram_gb: 16 } }, {
      condition: 'new', has_condition_offers: true,
    });
    const fixture = client({
      products: [laptop],
      offers: [
        { product_id: 'laptop', condition: 'used', price: 80, stock_quantity: 2, merchant_id: 'merchant-1', status: 'active' },
        { product_id: 'laptop', condition: 'new', price: 120, stock_quantity: 3, merchant_id: 'merchant-1', status: 'active' },
      ],
    });
    const result = await discoverStructuredProducts(input(
      fixture.supabase,
      intent({ product_type: 'laptop', attributes: [{ key: 'ram_gb', operator: 'gte', value: 16 }] }),
      { args: { condition: 'used' } }
    ));

    expect(result.selectedProducts[0]?.selectedOption).toMatchObject({ kind: 'offer', condition: 'used', price: 80 });
    expect(result.selectedProducts[0]?.displayCondition).toBe('used');
  });

  it('allows a zero-stock matching variant when stock tracking is disabled', async () => {
    const phone = product('untracked-phone', { product_type: 'phone' }, {
      has_variants: true, manage_stock: false,
    });
    const fixture = client({ products: [phone], variants: [
      { product_id: 'untracked-phone', id: 'variant-1', attributes: { storage: '256GB' }, price_override: 100, stock_quantity: 0 },
    ] });
    const result = await discoverStructuredProducts(input(
      fixture.supabase,
      intent({ product_type: 'phone', attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }] })
    ));

    expect(result.selectedProducts[0]?.selectedOption).toMatchObject({ kind: 'variant', option_id: 'variant-1' });
  });

  it('returns valid matches with partial coverage when the lexical scan reaches its cap', async () => {
    const ids = Array.from({ length: 500 }, (_, index) => `p-${index}`);
    const products = ids.map((id) => product(id, { product_type: 'security_camera' }));
    const fixture = client({ products, lexicalIds: ids, lexicalTotal: 501 });
    const result = await discoverStructuredProducts(input(
      fixture.supabase,
      intent({ product_type: 'security_camera' }),
      { query: 'security camera', args: { limit: 2 } }
    ));

    expect(result.coverage).toBe('partial');
    expect(result.priceScanComplete).toBe(true);
    expect(result.incompleteReason).toBeUndefined();
    expect(result.selectedProducts).toHaveLength(2);
    expect(fixture.lexicalCalls()).toBe(5);
  });

  it('preserves lexical results when semantic retrieval fails', async () => {
    const aroma = product('diffuser', { product_type: 'fragrance_diffuser' });
    const fixture = client({ products: [aroma] });
    const result = await discoverStructuredProducts(input(
      fixture.supabase,
      intent({ product_type: 'fragrance_diffuser' }),
      { semanticSearch: async () => { throw new Error('semantic service unavailable'); } }
    ));

    expect(result.selectedProducts.map(({ product: selected }) => selected.id)).toEqual(['diffuser']);
    expect(result.semanticUnavailable).toBe(true);
  });

  it('keeps phone and charger alternatives distinct and requires explicit hard facts', async () => {
    const phone = product('apple-phone', { product_type: 'phone', model: 'iPhone 15' }, { brand: 'Apple', category: 'Smartphones' });
    const charger = product('apple-charger', {
      product_type: 'charger', compatible_with: ['iPhone'], attributes: { power_w: 30 },
    }, { brand: 'Apple', category: 'Accessories' });
    const fixture = client({ products: [phone, charger] });
    const request = intent({
      product_type: 'charger', brands: ['Apple'], compatible_with: 'iPhone',
      attributes: [{ key: 'power_w', operator: 'gte', value: 20 }],
    });
    const result = await discoverStructuredProducts(input(fixture.supabase, request, {
      query: 'Apple charger compatible with iPhone, or Apple phone',
    }));
    expect(result.selectedProducts.map(({ product: selected }) => selected.id)).toEqual(['apple-charger']);

    const unknown = product('unverified-phone', { product_type: 'phone' }, {
      brand: 'Google', category: 'Smartphones', description: '256GB model',
    });
    const unknownFixture = client({ products: [unknown] });
    const unverified = await discoverStructuredProducts(input(
      unknownFixture.supabase,
      intent({ product_type: 'phone', brands: ['Google'], attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }] }),
      { query: 'Google phone 256GB under budget', args: { max_price: 500 } }
    ));
    expect(unverified.selectedProducts).toEqual([]);
  });

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

});
