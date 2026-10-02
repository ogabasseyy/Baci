import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
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
    if (name === 'get_mcp_search_serialized_anchor_policies') {
      return { data: [], error: null };
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
      returns: vi.fn(() => builder),
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

export const discoverStructuredProductsTestSupport = { client, product, intent, input };
