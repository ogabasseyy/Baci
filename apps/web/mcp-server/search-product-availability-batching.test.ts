import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hydrateSearchProductAvailability } from './search-product-availability';

// Serialized-policy discovery runs for every simple product; tests that do
// not exercise it stub an empty policy lookup.
function emptyPolicyFrom() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    returns: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return builder;
}

describe('hydrateSearchProductAvailability PostgREST paging', () => {
  it('pages variant lookups so no response can hit the 1,000-row clamp', async () => {
    const products = Array.from({ length: 8 }, (_, index) => ({
      id: `paged-${index}`,
      price: 1000,
      manage_stock: false,
      has_variants: true,
    }));
    const rpc = vi.fn(async (name: string, args: { p_product_ids: string[] }) => {
      if (name !== 'get_mcp_search_product_variants') {
        return { data: [], error: null };
      }
      return {
        data: args.p_product_ids.map((product_id) => ({
          id: `v-${product_id}`,
          product_id,
          attributes: {},
          price_override: 900,
          stock_quantity: 1,
        })),
        error: null,
      };
    });
    const supabase = { rpc, from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;

    const hydrated = await hydrateSearchProductAvailability(
      products,
      supabase,
      'merchant-1'
    );

    const variantCalls = rpc.mock.calls.filter(
      ([name]) => name === 'get_mcp_search_product_variants'
    );
    expect(variantCalls).toHaveLength(2);
    expect(variantCalls[0][1].p_product_ids).toHaveLength(7);
    expect(variantCalls[1][1].p_product_ids).toHaveLength(1);
    expect(hydrated).toHaveLength(8);
    for (const row of hydrated) {
      expect(row.allVariants).toHaveLength(1);
      expect(row.variantLookupFailed).toBe(false);
    }
  });

  it('fails only the products in a failed variant batch', async () => {
    const products = Array.from({ length: 15 }, (_, index) => ({
      id: `partial-${index}`,
      price: 1000,
      manage_stock: false,
      has_variants: true,
    }));
    let calls = 0;
    const rpc = vi.fn(async (name: string, args: { p_product_ids: string[] }) => {
      if (name !== 'get_mcp_search_product_variants') {
        return { data: [], error: null };
      }
      calls += 1;
      if (calls === 2) return { data: null, error: new Error('page offline') };
      return {
        data: args.p_product_ids.map((product_id) => ({
          id: `v-${product_id}`,
          product_id,
          attributes: {},
          price_override: 900,
          stock_quantity: 1,
        })),
        error: null,
      };
    });
    const supabase = { rpc, from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;

    const hydrated = await hydrateSearchProductAvailability(
      products,
      supabase,
      'merchant-1'
    );

    expect(hydrated).toHaveLength(15);
    hydrated.forEach((row, index) => {
      const failed = index >= 7 && index < 14;
      expect(row.variantLookupFailed).toBe(failed);
      expect(Boolean(row.optionsLookupFailed)).toBe(failed);
      expect(row.allVariants).toHaveLength(failed ? 0 : 1);
    });
  });

  it('fails only the products in a failed offer batch', async () => {
    const products = Array.from({ length: 63 }, (_, index) => ({
      id: `offer-partial-${index}`,
      price: 1000,
      manage_stock: false,
      has_condition_offers: true,
    }));
    let calls = 0;
    const rpc = vi.fn(async (name: string, args: { p_product_ids: string[] }) => {
      if (name !== 'get_mcp_search_product_offers') {
        return { data: [], error: null };
      }
      calls += 1;
      if (calls === 1) return { data: null, error: new Error('page offline') };
      return {
        data: args.p_product_ids.map((product_id) => ({
          id: `o-${product_id}`,
          product_id,
          condition: 'used',
          price: 800,
          stock_quantity: 1,
        })),
        error: null,
      };
    });
    const supabase = { rpc, from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;

    const hydrated = await hydrateSearchProductAvailability(
      products,
      supabase,
      'merchant-1'
    );

    expect(hydrated).toHaveLength(63);
    hydrated.forEach((row, index) => {
      const failed = index < 62;
      expect(row.offerLookupFailed).toBe(failed);
      expect(Boolean(row.optionsLookupFailed)).toBe(failed);
    });
    expect(hydrated[62].availableOffers).toHaveLength(1);
  });

  it('runs variant batches in bounded parallel waves', async () => {
    const products = Array.from({ length: 40 }, (_, index) => ({
      id: `concurrent-${index}`,
      price: 1000,
      manage_stock: false,
      has_variants: true,
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    let seen = 0;
    const gates: Array<() => void> = [];
    const rpc = vi.fn(async (name: string, args: { p_product_ids: string[] }) => {
      if (name !== 'get_mcp_search_product_variants') {
        return { data: [], error: null };
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight -= 1;
      return {
        data: args.p_product_ids.map((product_id) => ({
          id: `v-${product_id}`,
          product_id,
          attributes: {},
          price_override: 900,
          stock_quantity: 1,
        })),
        error: null,
      };
    });
    const supabase = { rpc, from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;

    const pending = hydrateSearchProductAvailability(products, supabase, 'merchant-1');
    // Six batches of seven: release each wave as it arrives so the run
    // completes while the in-flight peak stays observable.
    for (let tick = 0; tick < 100 && seen < 6; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen += gates.length;
      let gate = gates.shift();
      while (gate) {
        gate();
        gate = gates.shift();
      }
    }
    const hydrated = await pending;

    expect(seen).toBe(6);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(hydrated).toHaveLength(40);
    for (const row of hydrated) {
      expect(row.allVariants).toHaveLength(1);
      expect(row.variantLookupFailed).toBe(false);
    }
  });
});
