import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { discoverStructuredProducts } from './discover-structured-products';

type Fixture = {
  products: Array<Record<string, unknown>>;
  variants?: Array<Record<string, unknown>>;
  serializedError?: Error;
};

function client(fixture: Fixture) {
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'search_product_discovery_facts') return { data: [], error: null };
    if (name === 'search_products_v2') {
      return { data: fixture.products.map((product) => ({ product_id: product.id })), error: null };
    }
    if (name === 'get_mcp_search_product_variants') {
      const ids = args?.p_product_ids as string[];
      return { data: (fixture.variants ?? []).filter((row) => ids.includes(String(row.product_id))), error: null };
    }
    if (name === 'get_mcp_search_product_offers') return { data: [], error: null };
    if (name === 'search_product_variant_recall') return { data: [], error: null };
    if (name === 'get_public_serialized_variant_availability_counts') {
      if (fixture.serializedError) throw fixture.serializedError;
      return { data: [], error: null };
    }
    return { data: null, error: new Error(`Unexpected RPC ${name}`) };
  });

  const from = vi.fn((table: string) => {
    const filters: Array<{ column: string; values: unknown[] }> = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => { filters.push({ column, values: [value] }); return builder; }),
      in: vi.fn((column: string, values: unknown[]) => { filters.push({ column, values }); return builder; }),
      order: vi.fn(() => builder),
      range: vi.fn(() => builder),
      returns: vi.fn(() => builder),
      then: (resolve: (value: unknown) => unknown) => {
        const rows = table === 'products' ? fixture.products : (fixture.variants ?? []);
        const data = rows.filter((row) => filters.every((filter) => filter.values.includes(row[filter.column])));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return builder;
  });

  return { supabase: { rpc, from } as unknown as SupabaseClient };
}

function product(id: string, metadata: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  return {
    id,
    merchant_id: 'merchant-1',
    status: 'active',
    name: id,
    slug: id,
    category: 'Smartphones',
    brand: null,
    condition: 'new',
    price: 100,
    compare_at_price: null,
    manage_stock: true,
    stock_quantity: 1,
    has_variants: false,
    has_condition_offers: false,
    discovery_metadata: metadata,
    ...extras,
  };
}

const intent = (...alternatives: McpDiscoveryIntent['alternatives']): McpDiscoveryIntent => ({ alternatives });

describe('discoverStructuredProducts integrity', () => {
  it('marks the scan incomplete when a serialized lookup fails', async () => {
    const row = product('serialized-phone', { product_type: 'phone' }, { inventory_tracking_policy: 'serialized_strict' });
    const fixture = client({
      products: [row],
      variants: [{ id: 'anchor-1', product_id: 'serialized-phone', merchant_id: 'merchant-1', is_inventory_anchor: true }],
      serializedError: new Error('counts offline'),
    });
    const result = await discoverStructuredProducts({
      intent: intent({ product_type: 'phone' }),
      query: 'phone',
      args: {},
      merchantId: 'merchant-1',
      supabase: fixture.supabase,
    });

    expect(result).toMatchObject({
      priceScanComplete: false,
      coverage: 'partial',
      incompleteReason: 'option_lookup_failed',
    });
  });

  it('excludes variant-truncated rows the PDP would refuse', async () => {
    const row = product('wide-phone', { product_type: 'phone' }, { has_variants: true });
    const variants = Array.from({ length: 129 }, (_, index) => ({
      id: `wide-v-${index}`,
      product_id: 'wide-phone',
      merchant_id: 'merchant-1',
      attributes: {},
      price_override: 90,
      stock_quantity: 1,
    }));
    const fixture = client({ products: [row], variants });
    const result = await discoverStructuredProducts({
      intent: intent({ product_type: 'phone' }),
      query: 'phone',
      args: {},
      merchantId: 'merchant-1',
      supabase: fixture.supabase,
    });

    expect(result.selectedProducts).toEqual([]);
    expect(result).toMatchObject({ coverage: 'partial', priceScanComplete: true });
  });

  it('selects the same product inside the variant window', async () => {
    const row = product('wide-phone', { product_type: 'phone' }, { has_variants: true });
    const variants = Array.from({ length: 128 }, (_, index) => ({
      id: `wide-v-${index}`,
      product_id: 'wide-phone',
      merchant_id: 'merchant-1',
      attributes: {},
      price_override: 90,
      stock_quantity: 1,
    }));
    const fixture = client({ products: [row], variants });
    const result = await discoverStructuredProducts({
      intent: intent({ product_type: 'phone' }),
      query: 'phone',
      args: {},
      merchantId: 'merchant-1',
      supabase: fixture.supabase,
    });

    expect(result.selectedProducts.map(({ product: selected }) => selected.id)).toEqual(['wide-phone']);
    expect(result).toMatchObject({ coverage: 'complete', priceScanComplete: true });
  });
});
