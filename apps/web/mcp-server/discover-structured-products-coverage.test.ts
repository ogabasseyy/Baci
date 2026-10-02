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
    if (name === 'get_mcp_search_product_variants') {
      if (fixture.variantError) return { data: null, error: fixture.variantError };
      const ids = args?.p_product_ids as string[];
      return { data: (fixture.variants ?? []).filter((row) => ids.includes(String(row.product_id))), error: null };
    }
    if (name === 'get_mcp_search_product_offers') {
      if (fixture.offerError) return { data: null, error: fixture.offerError };
      const ids = args?.p_product_ids as string[];
      const rows = (fixture.offers ?? []).filter((row) => ids.includes(String(row.product_id)));
      rows.sort((left, right) => String(left.condition).localeCompare(String(right.condition)) || String(left.id).localeCompare(String(right.id)));
      return { data: rows, error: null };
    }
    if (name === 'search_product_variant_recall') {
      const merchant = String(args?.p_merchant_id ?? '');
      return { data: (fixture.variants ?? []).filter((row) => String(row.merchant_id ?? '') === merchant), error: null };
    }
    if (name === 'get_mcp_search_serialized_anchor_policies') {
      return { data: [], error: null };
    }
    if (name === 'search_products_browse') {
      const limit = Number(args?.p_limit ?? 100);
      const offset = Number(args?.p_offset ?? 0);
      return { data: fixture.products.slice(offset, offset + limit), error: null };
    }
    return { data: null, error: new Error(`Unexpected RPC ${name}`) };
  });

  const from = vi.fn((table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    const orders: string[] = [];
    let range: [number, number] | undefined;
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => { filters.push(['eq', column, value]); return builder; }),
      in: vi.fn((column: string, value: unknown) => { filters.push(['in', column, value]); return builder; }),
      order: vi.fn((column: string) => {orders.push(column); return builder;}),
      returns: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => {range = [start, end]; return builder;}),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (table === 'product_offers' && fixture.offerError) return Promise.resolve({ data: null, error: fixture.offerError }).then(resolve, reject);
        let rows = table === 'products' ? fixture.products : fixture.offers ?? [];
        for (const [kind, column, value] of filters) {
          if (kind === 'eq') rows = rows.filter((row) => row[column] === value);
          if (kind === 'in' && Array.isArray(value)) rows = rows.filter((row) => value.includes(row[column]));
        }
        for (const column of [...orders].reverse()) rows = [...rows].sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')));
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

  it('ignores window truncation from products definitively excluded by identity', async () => {
    const excluded = product('excluded-laptop', { product_type: 'laptop' }, { has_variants: true });
    const variants = Array.from({ length: 129 }, (_, index) => ({
      id: `v-${index}`, product_id: 'excluded-laptop', attributes: {}, price_override: 100 + index, stock_quantity: 1,
    }));
    const fixture = client({ products: [excluded, product('match-phone', { product_type: 'phone' })], variants });
    const result = await discoverStructuredProducts(input(fixture.supabase,
      intent({ product_type: 'phone' }), { query: 'phone', args: { sort: 'price_asc' } }));
    expect(result.selectedProducts.map(({ product: s }) => s.id)).toEqual(['match-phone']);
    expect(result).toMatchObject({ priceScanComplete: true, coverage: 'complete' });
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

  it('hydrates condition offers before condition filtering when the row snapshot is stale', async () => {
    const row = product('offer-phone', {product_type: 'phone'}, {has_condition_offers: true, available_conditions: []});
    const fixture = client({products: [row], offers: [{id: 'ob-1', product_id: 'offer-phone', merchant_id: 'merchant-1', status: 'active', condition: 'open_box', price: 400, compare_at_price: null, stock_quantity: 1}]});
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({product_type: 'phone'}), {args: {condition: 'open_box'}}));
    expect(result.selectedProducts.map(({product}) => product.id)).toEqual(['offer-phone']);
  });

  it('hydrates used variants when the parent condition snapshot is stale', async () => {
    const phone = product('used-variant-phone', { product_type: 'phone' }, { condition: 'new', available_conditions: [], has_variants: true });
    const fixture = client({ products: [phone], variants: [{ id: 'used-variant', product_id: 'used-variant-phone', condition: 'uk_used', attributes: { storage: '256GB' }, price_override: 100, stock_quantity: 2 }] });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({ product_type: 'phone' }), { args: { condition: 'used' } }));
    expect(result.selectedProducts[0]?.selectedOption).toMatchObject({ kind: 'variant', option_id: 'used-variant', condition: 'used' });
  });

  it('treats an offer failure as complete when the requested condition rules every missing offer ineligible', async () => {
    const fixture = client({ products: [product('new-base', { product_type: 'phone' }, { has_condition_offers: true })], factIds: ['new-base'], offerError: new Error('offline') });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({ product_type: 'phone' }), { query: undefined, args: { condition: 'new' } }));
    expect(result.selectedProducts.map(({ product: s }) => s.id)).toEqual(['new-base']);
    expect(result).toMatchObject({ priceScanComplete: true, coverage: 'partial' });
  });

  it('still vetoes an offer failure when a missing offer could match the requested condition', async () => {
    const fixture = client({ products: [product('new-base', { product_type: 'phone' }, { has_condition_offers: true })], factIds: ['new-base'], offerError: new Error('offline') });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({ product_type: 'phone' }), { args: { condition: 'used' } }));
    expect(result).toMatchObject({ priceScanComplete: false, coverage: 'partial', incompleteReason: 'option_lookup_failed' });
  });

  it('ignores an offer failure when variants own the condition axis', async () => {
    const p = product('axis-phone', { product_type: 'phone' }, { has_variants: true, has_condition_offers: true });
    const fixture = client({ products: [p], factIds: ['axis-phone'], variants: [{ id: 'v-used', product_id: 'axis-phone', condition: 'used', attributes: {}, price_override: 100, stock_quantity: 1 }], offerError: new Error('offline') });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({ product_type: 'phone' }), { query: undefined }));
    expect(result.selectedProducts.map(({ product: s }) => s.id)).toEqual(['axis-phone']);
    expect(result).toMatchObject({ priceScanComplete: true, coverage: 'partial' });
  });

  it('recalls a variant-only spec the product-level sources miss', async () => {
    const p = product('variant-spec-phone', { product_type: 'phone' }, { has_variants: true });
    const fixture = client({ products: [p], lexicalIds: [], factIds: [],
      variants: [{ id: 'v-256', product_id: 'variant-spec-phone', merchant_id: 'merchant-1', attributes: { Storage: '256GB' }, price_override: 100, stock_quantity: 1 }] });
    const result = await discoverStructuredProducts(input(fixture.supabase,
      intent({ product_type: 'phone', attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }] }), { query: undefined }));
    expect(result.selectedProducts.map(({ product: s }) => s.id)).toEqual(['variant-spec-phone']);
    expect(result.coverage).toBe('partial');
  });

  it('recalls variants satisfying range constraints the product sources miss', async () => {
    const p = product('range-phone', { product_type: 'phone' }, { has_variants: true });
    const fixture = client({ products: [p], lexicalIds: [], factIds: [],
      variants: [{ id: 'v-512', product_id: 'range-phone', merchant_id: 'merchant-1', attributes: { Storage: '512GB' }, price_override: 100, stock_quantity: 1 }] });
    const result = await discoverStructuredProducts(input(fixture.supabase,
      intent({ product_type: 'phone', attributes: [{ key: 'storage_gb', operator: 'gte', value: 256 }] }), { query: undefined }));
    expect(result.selectedProducts.map(({ product: s }) => s.id)).toEqual(['range-phone']);
  });

  it('does not recall variants that fail range constraints', async () => {
    const p = product('small-phone', { product_type: 'phone' }, { has_variants: true });
    const fixture = client({ products: [p], lexicalIds: [], factIds: [],
      variants: [{ id: 'v-128', product_id: 'small-phone', merchant_id: 'merchant-1', attributes: { Storage: '128GB' }, price_override: 100, stock_quantity: 1 }] });
    const result = await discoverStructuredProducts(input(fixture.supabase,
      intent({ product_type: 'phone', attributes: [{ key: 'storage_gb', operator: 'gte', value: 256 }] }), { query: undefined }));
    expect(result.selectedProducts).toEqual([]);
    expect(result.coverage).toBe('partial');
  });

  it('boosts exact keyword hits that also satisfy the structured facts', async () => {
    const a = product('aaa', { product_type: 'phone' });
    const b = product('zzz', { product_type: 'phone' });
    const fixture = client({ products: [a, b], lexicalIds: ['aaa', 'zzz'], factIds: ['zzz'] });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({ product_type: 'phone' }), { query: 'iPhone' }));
    expect(result.selectedProducts.map(({ product: s }) => s.id)).toEqual(['zzz', 'aaa']);
  });

  it('dedupes canonical offer conditions in PDP condition order', async () => {
    const p = product('ordered-offers', { product_type: 'phone' }, { has_condition_offers: true, price: 1000 });
    const fixture = client({ products: [p], offers: [
      { id: 'ref-1', product_id: 'ordered-offers', merchant_id: 'merchant-1', status: 'active', condition: 'refurbished', price: 450, compare_at_price: null, stock_quantity: 1 },
      { id: 'ob-1', product_id: 'ordered-offers', merchant_id: 'merchant-1', status: 'active', condition: 'open_box', price: 500, compare_at_price: null, stock_quantity: 1 },
    ] });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({ product_type: 'phone' })));
    expect(result.selectedProducts[0]?.selectedOption).toMatchObject({ kind: 'offer', option_id: 'ob-1', price: 500 });
  });

  it('marks a fact-only constrained search partial even when every hydrated row verifies', async () => {
    const fixture = client({ products: [product('phone', { product_type: 'phone' })] });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({ product_type: 'charger', model: 'ZX42' }), { query: undefined }));
    expect(result.selectedProducts).toEqual([]);
    expect(result.coverage).toBe('partial');
  });

  it('retains complete coverage for an unconstrained fact-only browse', async () => {
    const fixture = client({ products: [product('phone', { product_type: 'phone' })] });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({}), { query: undefined }));
    expect(result.coverage).toBe('complete');
  });

  it('discloses partial coverage when a product exceeds the variant window', async () => {
    const p = product('wide', { product_type: 'phone' }, { has_variants: true });
    const variants = Array.from({ length: 129 }, (_, i) => ({
      id: `v-${i}`, product_id: 'wide', merchant_id: 'merchant-1',
      attributes: { color: 'black' }, stock_quantity: 1, price_override: 100 + i,
    }));
    const fixture = client({ products: [p], variants });
    const result = await discoverStructuredProducts(input(fixture.supabase, intent({})));
    expect(result.coverage).toBe('partial');
  });
});
