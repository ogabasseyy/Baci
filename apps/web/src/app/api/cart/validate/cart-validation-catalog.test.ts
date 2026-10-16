import { describe, expect, it, vi } from 'vitest';
import {
  buildCartValidationCatalog,
  fetchAllStorefrontProductVariants,
  fetchStrictPoolUnits,
  resolveCartValidationCatalog,
} from './cart-validation-catalog';

const STR_ID = '11111111-1111-4111-8111-111111111111';

describe('resolveCartValidationCatalog', () => {
  const ok = { error: null };

  it('returns the narrowed offer map when every load succeeded', () => {
    const offerMap = new Map([['k', 'v']]);
    const result = resolveCartValidationCatalog({
      productsResult: ok,
      variantsResult: ok,
      offerMap,
    });
    expect(result.catalogError).toBeNull();
    expect(result.offerMap).toBe(offerMap);
  });

  it.each([
    'products',
    'variants',
    'offers',
  ] as const)('maps a %s load failure to the shared 500', async (which) => {
    const result = resolveCartValidationCatalog({
      productsResult: which === 'products' ? { error: { message: 'x' } } : ok,
      variantsResult: which === 'variants' ? { error: { message: 'x' } } : ok,
      offerMap: which === 'offers' ? new Error('x') : new Map(),
    });
    expect(result.offerMap).toBeNull();
    expect(result.catalogError?.status).toBe(500);
    expect(await result.catalogError?.json()).toEqual({
      error: 'Failed to validate cart.',
    });
  });
});

describe('buildCartValidationCatalog', () => {
  it('indexes products and variants for per-line lookups', () => {
    const product = { id: STR_ID, name: 'Phone' };
    const variant = { id: 'v1', product_id: STR_ID };
    const catalog = buildCartValidationCatalog([product], [variant]);
    expect(catalog.productMap.get(STR_ID)).toBe(product);
    expect(catalog.variantMap.get('v1')).toBe(variant);
    expect(catalog.productsWithLiveVariants.has(STR_ID)).toBe(true);
  });
});

describe('fetchStrictPoolUnits', () => {
  const strictProduct = {
    id: STR_ID,
    inventory_tracking_policy: 'serialized_strict',
  };

  it('returns an empty map without calling the RPC when no simple lines exist', async () => {
    const rpc = vi.fn();
    const empty = await fetchStrictPoolUnits({
      supabase: { rpc },
      products: [strictProduct],
      simpleProductTotals: new Map(),
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(empty.size).toBe(0);
  });

  it('queries every simple-line product regardless of parent policy', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const other = 'other';
    await fetchStrictPoolUnits({
      supabase: { rpc },
      products: [
        { id: STR_ID, inventory_tracking_policy: 'off' },
        { id: other, inventory_tracking_policy: 'serialized_strict' },
        { id: 'nosimple', inventory_tracking_policy: 'serialized_strict' },
      ],
      simpleProductTotals: new Map([
        [STR_ID, 1],
        [other, 2],
      ]),
    });
    expect(rpc).toHaveBeenCalledWith('get_storefront_product_base_inventory', {
      p_product_ids: [STR_ID, other],
    });
  });

  it('maps the projection rows to per-product pools', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          product_id: STR_ID,
          effective_policy: 'serialized_strict',
          available_units: 2,
        },
        {
          product_id: 'other',
          effective_policy: 'serialized_strict',
          available_units: '3',
        },
        {
          product_id: 'bad',
          effective_policy: 'serialized_strict',
          available_units: 'n/a',
        },
      ],
      error: null,
    }));
    const pools = await fetchStrictPoolUnits({
      supabase: { rpc },
      products: [strictProduct],
      simpleProductTotals: new Map([[STR_ID, 1]]),
    });
    expect(rpc).toHaveBeenCalledWith('get_storefront_product_base_inventory', {
      p_product_ids: [STR_ID],
    });
    expect(pools.get(STR_ID)).toBe(2);
    expect(pools.get('other')).toBe(3);
    expect(pools.has('bad')).toBe(false);
  });

  it('follows the anchor-first effective policy over the parent policy', async () => {
    const parentStrictAnchorOff = '22222222-2222-4222-8222-222222222222';
    const parentOffAnchorStrict = '33333333-3333-4333-8333-333333333333';
    const rpc = vi.fn(async () => ({
      data: [
        {
          product_id: parentStrictAnchorOff,
          effective_policy: 'off',
          available_units: 0,
        },
        {
          product_id: parentOffAnchorStrict,
          effective_policy: 'serialized_strict',
          available_units: 4,
        },
      ],
      error: null,
    }));
    const pools = await fetchStrictPoolUnits({
      supabase: { rpc },
      products: [
        {
          id: parentStrictAnchorOff,
          inventory_tracking_policy: 'serialized_strict',
        },
        { id: parentOffAnchorStrict, inventory_tracking_policy: 'off' },
      ],
      simpleProductTotals: new Map([
        [parentStrictAnchorOff, 1],
        [parentOffAnchorStrict, 1],
      ]),
    });
    // A strict parent with an off anchor must not cap simple lines at
    // zero units; a non-strict parent with a strict anchor must pool.
    expect(pools.has(parentStrictAnchorOff)).toBe(false);
    expect(pools.get(parentOffAnchorStrict)).toBe(4);
  });

  it('fails open to an empty map when the projection read fails', async () => {
    const failing = vi.fn(async () => ({
      data: null,
      error: { message: 'boom' },
    }));
    const throwing = vi.fn(async () => {
      throw new Error('boom');
    });
    for (const rpc of [failing, throwing]) {
      const pools = await fetchStrictPoolUnits({
        supabase: { rpc },
        products: [strictProduct],
        simpleProductTotals: new Map([[STR_ID, 1]]),
      });
      expect(pools.size).toBe(0);
    }
  });
});

describe('fetchAllStorefrontProductVariants', () => {
  type Row = { id: string; product_id: string };

  function client(pages: Array<{ data: Row[] | null; error: unknown }>) {
    const range = vi.fn(async (from: number) => {
      const index = Math.floor(from / 1000);
      return pages[index] ?? { data: [] as Row[], error: null };
    });
    const rpc = vi.fn(() => ({ range }));
    return { rpc, range, supabase: { rpc } };
  }

  it('returns a single short page with one ranged call', async () => {
    const { rpc, range, supabase } = client([
      { data: [{ id: 'v1', product_id: STR_ID }], error: null },
    ]);

    const result = await fetchAllStorefrontProductVariants<Row>({
      supabase,
      productIds: [STR_ID],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: 'v1', product_id: STR_ID }]);
    expect(rpc).toHaveBeenCalledWith('get_storefront_product_variants', {
      p_product_ids: [STR_ID],
    });
    expect(range).toHaveBeenCalledTimes(1);
    expect(range).toHaveBeenCalledWith(0, 999);
  });

  it('concatenates full pages until the first short page', async () => {
    const full = Array.from({ length: 1000 }, (_, index) => ({
      id: `v${index}`,
      product_id: STR_ID,
    }));
    const { range, supabase } = client([
      { data: full, error: null },
      { data: [{ id: 'v-tail', product_id: STR_ID }], error: null },
    ]);

    const result = await fetchAllStorefrontProductVariants<Row>({
      supabase,
      productIds: [STR_ID],
    });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1001);
    expect(result.data?.[1000]).toEqual({
      id: 'v-tail',
      product_id: STR_ID,
    });
    expect(range).toHaveBeenCalledTimes(2);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it('fails closed with the route error shape on RPC failure', async () => {
    const { supabase } = client([{ data: null, error: { message: 'boom' } }]);

    const result = await fetchAllStorefrontProductVariants<Row>({
      supabase,
      productIds: [STR_ID],
    });

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ message: 'boom' });
  });
});
