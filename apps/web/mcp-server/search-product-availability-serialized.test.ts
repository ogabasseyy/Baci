import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hydrateSearchProductAvailability } from './search-product-availability';

function chain<T>(data: T) {
  const query: Record<string, (...args: never[]) => unknown> = {};
  const self = () => query as never;
  query.select = self;
  query.eq = self;
  query.in = self;
  query.returns = self;
  query.overrideTypes = self;
  query.retry = self;
  query.then = ((resolve: (value: { data: T; error: null }) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve)) as never;
  return query;
}

function serializedSupabase(options: {
  policy: string;
  units: number;
  anchorPolicy?: string;
}) {
  const from = vi.fn((table: string) => {
    if (table === 'products') {
      return chain([
        {
          id: 'serialized-phone',
          inventory_tracking_policy: options.policy,
          has_variants: false,
          status: 'active',
        },
      ]);
    }
    return chain([
      {
        id: 'anchor-1',
        product_id: 'serialized-phone',
        inventory_tracking_policy: options.anchorPolicy ?? 'inherit',
        is_inventory_anchor: true,
      },
    ]);
  });
  const rpc = vi.fn((name: string) => {
    if (name === 'get_public_serialized_variant_availability_counts') {
      return chain(
        options.units > 0
          ? [
              {
                product_id: 'serialized-phone',
                variant_id: null,
                public_available_units: options.units,
              },
            ]
          : []
      );
    }
    return { data: [], error: null };
  });
  return { from, rpc } as unknown as SupabaseClient;
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
    const supabase = {
      from: vi.fn(() => {
        throw new Error('counts unavailable');
      }),
      rpc: vi.fn(async () => ({ data: [], error: null })),
    } as unknown as SupabaseClient;
    const [hydrated] = await hydrateSearchProductAvailability(
      [serializedProduct],
      supabase,
      'merchant-1'
    );

    expect(hydrated).toMatchObject({ basePurchasable: false });
    expect(hydrated.product.stock_quantity).toBe(0);
  });

  it('flags rows whose serialized lookup failed instead of passing them as verified', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('counts unavailable');
      }),
      rpc: vi.fn(async () => ({ data: [], error: null })),
    } as unknown as SupabaseClient;
    const [hydrated] = await hydrateSearchProductAvailability(
      [serializedProduct],
      supabase,
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
