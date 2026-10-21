import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockWarn = jest.fn();
const mockRange =
  jest.fn<
    (...args: unknown[]) => Promise<{
      data: Array<{ product_id: string }> | null;
      count: number | null;
      error: { message: string } | null;
    }>
  >();
const mockRpc = jest.fn<(name: string, ...args: unknown[]) => unknown>();

jest.mock('@/lib/logger', () => ({
  // Defer the mockWarn read to call time: the static import below
  // evaluates createLogger before this module's consts initialize.
  createLogger: () => ({ warn: (...args: unknown[]) => mockWarn(...args) }),
}));
jest.mock('@/lib/supabase', () => ({
  get supabase() {
    return { rpc: mockRpc };
  },
}));

import {
  fetchOfferEligibleParents,
  fetchVariantOverrides,
  type OfferParentRow,
  resolveVariantLinePrice,
} from './cart-reprice-variants';

type OverrideRow = {
  id: string;
  product_id: string;
  price_override: number | string | null;
};

function mockOverrides(data: OverrideRow[] | null) {
  mockRpc.mockImplementation(() => Promise.resolve({ data, error: null }));
}

function mockPresence(
  pages: Array<{
    data: Array<{ product_id: string }> | null;
    count: number | null;
    error?: { message: string } | null;
  }>
) {
  mockRpc.mockImplementation(() => ({
    range: (...args: unknown[]) => mockRange(...args),
  }));
  for (const page of pages) {
    mockRange.mockResolvedValueOnce({
      data: page.data,
      count: page.count,
      error: page.error ?? null,
    });
  }
}

const PARENT: OfferParentRow = {
  id: 'product-1',
  has_condition_offers: true,
  has_variants: false,
  variant_model: 'legacy',
};

describe('fetchVariantOverrides', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty without calling when no variants are needed', async () => {
    const result = await fetchVariantOverrides([]);

    expect(result).toEqual({ overrides: new Map(), failed: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps rows with the owning product and coerces string prices', async () => {
    mockOverrides([
      { id: 'v1', product_id: 'p1', price_override: 400 },
      { id: 'v2', product_id: 'p1', price_override: '420.5' },
      { id: 'v3', product_id: 'p2', price_override: null },
    ]);

    const result = await fetchVariantOverrides(['v1', 'v2', 'v3']);

    expect(mockRpc).toHaveBeenCalledWith('get_order_variant_overrides', {
      p_variant_ids: ['v1', 'v2', 'v3'],
    });
    expect(result.failed).toBe(false);
    expect(result.overrides.get('v1')).toEqual({
      price: 400,
      productId: 'p1',
    });
    expect(result.overrides.get('v2')).toEqual({
      price: 420.5,
      productId: 'p1',
    });
    expect(result.overrides.get('v3')).toEqual({
      price: null,
      productId: 'p2',
    });
  });

  it('fails open so callers skip variant lines on RPC error', async () => {
    mockRpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: 'rpc down' } })
    );

    const result = await fetchVariantOverrides(['v1']);

    expect(result.failed).toBe(true);
    expect(result.overrides.size).toBe(0);
    expect(mockWarn).toHaveBeenCalled();
  });
});

describe('fetchOfferEligibleParents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty without probing when no candidates exist', async () => {
    const result = await fetchOfferEligibleParents([PARENT], []);

    expect(result).toEqual({ eligible: new Set(), failed: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('marks a flagged non-variant parent with no live variants eligible', async () => {
    mockPresence([{ data: [], count: 0 }]);

    const result = await fetchOfferEligibleParents([PARENT], ['product-1']);

    expect(result.failed).toBe(false);
    expect(result.eligible).toEqual(new Set(['product-1']));
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      { p_product_ids: ['product-1'] },
      { count: 'exact' }
    );
  });

  it('rejects flag-disabled, variant-bearing, and live-variant parents', async () => {
    mockPresence([{ data: [{ product_id: 'product-live' }], count: 1 }]);

    const result = await fetchOfferEligibleParents(
      [
        { ...PARENT, id: 'product-off', has_condition_offers: false },
        { ...PARENT, id: 'product-variants', has_variants: true },
        { ...PARENT, id: 'product-matrix', variant_model: 'sku_matrix' },
        { ...PARENT, id: 'product-live' },
      ],
      ['product-off', 'product-variants', 'product-matrix', 'product-live']
    );

    expect(result.failed).toBe(false);
    expect(result.eligible.size).toBe(0);
  });

  it('fails open when the presence probe errors or returns garbage', async () => {
    mockPresence([{ data: null, count: null, error: { message: 'down' } }]);
    expect(
      (await fetchOfferEligibleParents([PARENT], ['product-1'])).failed
    ).toBe(true);

    jest.clearAllMocks();
    mockPresence([{ data: [], count: Number.NaN }]);
    expect(
      (await fetchOfferEligibleParents([PARENT], ['product-1'])).failed
    ).toBe(true);
  });

  it('paginates past a full page until every candidate is proven', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      product_id: `other-${index}`,
    }));
    mockPresence([
      { data: firstPage, count: 501 },
      { data: [{ product_id: 'product-1' }], count: 501 },
    ]);

    const result = await fetchOfferEligibleParents([PARENT], ['product-1']);

    expect(result.failed).toBe(false);
    expect(result.eligible.size).toBe(0);
    expect(mockRange).toHaveBeenCalledTimes(2);
    expect(mockRange).toHaveBeenNthCalledWith(2, 500, 999);
  });
});

describe('resolveVariantLinePrice', () => {
  it('returns null for missing or cross-product variant rows', () => {
    expect(
      resolveVariantLinePrice(
        { variant_id: 'v-missing', product_id: 'p1' },
        new Map(),
        500
      )
    ).toBeNull();
    expect(
      resolveVariantLinePrice(
        { variant_id: 'v1', product_id: 'p1' },
        new Map([['v1', { price: 400, productId: 'p2' }]]),
        500
      )
    ).toBeNull();
  });

  it('prefers the override and inherits the parent price on null', () => {
    expect(
      resolveVariantLinePrice(
        { variant_id: 'v1', product_id: 'p1' },
        new Map([['v1', { price: 400, productId: 'p1' }]]),
        500
      )
    ).toBe(400);
    expect(
      resolveVariantLinePrice(
        { variant_id: 'v1', product_id: 'p1' },
        new Map([['v1', { price: null, productId: 'p1' }]]),
        500
      )
    ).toBe(500);
  });
});
