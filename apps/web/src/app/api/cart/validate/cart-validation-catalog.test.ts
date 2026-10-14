import { describe, expect, it, vi } from 'vitest';
import {
  buildCartValidationCatalog,
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

  it('returns an empty map without calling the RPC when no strict lines exist', async () => {
    const rpc = vi.fn();
    const pools = await fetchStrictPoolUnits({
      supabase: { rpc },
      products: [
        { id: STR_ID, inventory_tracking_policy: 'off' },
        strictProduct,
      ],
      simpleProductTotals: new Map([[STR_ID, 1]]),
    });
    // Non-strict product skipped; strict product queried.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(pools.size).toBe(0);

    const rpc2 = vi.fn();
    const empty = await fetchStrictPoolUnits({
      supabase: { rpc: rpc2 },
      products: [{ id: STR_ID, inventory_tracking_policy: null }],
      simpleProductTotals: new Map([[STR_ID, 1]]),
    });
    expect(rpc2).not.toHaveBeenCalled();
    expect(empty.size).toBe(0);
  });

  it('maps the projection rows to per-product pools', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { product_id: STR_ID, available_units: 2 },
        { product_id: 'other', available_units: '3' },
        { product_id: 'bad', available_units: 'n/a' },
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
