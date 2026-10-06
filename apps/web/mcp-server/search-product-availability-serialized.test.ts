import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hydrateSearchProductAvailability } from './search-product-availability';

function serializedSupabase(options: {
  policy: string;
  units: number;
}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'get_mcp_search_serialized_anchor_policies') {
      return {
        data: [
          {
            product_id: 'serialized-phone',
            effective_policy: options.policy,
            available_units: options.units,
          },
        ],
        error: null,
      };
    }
    return { data: [], error: null };
  });
  return { rpc } as unknown as SupabaseClient;
}

function failingAnchorSupabase() {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'get_mcp_search_serialized_anchor_policies') {
      return { data: null, error: new Error('anchor offline') };
    }
    return { data: [], error: null };
  });
  return { rpc } as unknown as SupabaseClient;
}

const serializedProduct = {
  id: 'serialized-phone',
  price: 50000,
  manage_stock: true,
  has_variants: false,
  stock_quantity: 0,
};

describe('hydrateSearchProductAvailability serialized projection', () => {
  it('keeps a serialized_strict simple product purchasable from available units', async () => {
    const supabase = serializedSupabase({
      policy: 'serialized_strict',
      units: 3,
    });
    const [hydrated] = await hydrateSearchProductAvailability(
      [serializedProduct],
      supabase,
      'merchant-1'
    );

    expect(hydrated).toMatchObject({
      basePurchasable: true,
      displayPrice: 50000,
      stockSummary: { inStock: true },
    });
    expect(hydrated.product.stock_quantity).toBe(3);
  });

  it('keeps serialized_then_unlimited purchasable once units run out', async () => {
    const supabase = serializedSupabase({
      policy: 'serialized_then_unlimited',
      units: 0,
    });
    const [hydrated] = await hydrateSearchProductAvailability(
      [serializedProduct],
      supabase,
      'merchant-1'
    );

    expect(hydrated).toMatchObject({
      basePurchasable: true,
      // Untracked stock reads unknown, exactly like unmanaged products.
      stockSummary: { inStock: null },
    });
    expect(hydrated.product.stock_quantity).toBe(9999);
    expect(hydrated.product.manage_stock).toBe(false);
  });

  it('falls back to stored stock when the availability lookup fails', async () => {
    const [hydrated] = await hydrateSearchProductAvailability(
      [serializedProduct],
      failingAnchorSupabase(),
      'merchant-1'
    );

    expect(hydrated).toMatchObject({ basePurchasable: false });
    expect(hydrated.product.stock_quantity).toBe(0);
  });

  it('flags rows whose serialized lookup failed instead of passing them as verified', async () => {
    const [hydrated] = await hydrateSearchProductAvailability(
      [serializedProduct],
      failingAnchorSupabase(),
      'merchant-1'
    );

    expect(hydrated).toMatchObject({
      serializedLookupFailed: true,
      optionsLookupFailed: true,
      variantLookupFailed: false,
      offerLookupFailed: false,
    });
  });
});
