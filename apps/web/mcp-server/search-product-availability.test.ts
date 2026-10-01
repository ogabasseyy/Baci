import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hydrateSearchProductAvailability } from './search-product-availability';
import { selectSearchProductsByPrice } from './select-search-products-by-price';
import { selectStructuredDiscoveryOffer } from './select-structured-discovery-offer';

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

describe('hydrateSearchProductAvailability', () => {
  it('uses the purchasable price for the requested condition', async () => {
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; condition: string; price: number; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [
          { product_id: 'priced-phone', condition: 'used', price: 80000, stock_quantity: 2 },
        ], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    offerQuery.order.mockReturnValue(offerQuery);
    const supabase = { rpc: vi.fn(async (name: string) => name === 'get_mcp_search_product_offers' ? await offerQuery : { data: [], error: null }), from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;
    const product = { id: 'priced-phone', condition: 'new', price: 100000,
      manage_stock: true, has_condition_offers: true, stock_quantity: 3 };

    const [base] = await hydrateSearchProductAvailability([product], supabase, 'merchant-1', 'new');
    const [used] = await hydrateSearchProductAvailability([product], supabase, 'merchant-1', 'used');
    const [unfiltered] = await hydrateSearchProductAvailability([product], supabase, 'merchant-1');

    expect(base).toMatchObject({ displayPrice: 100000, stockSummary: { inStock: true } });
    expect(used).toMatchObject({ displayPrice: 80000, stockSummary: { inStock: true } });
    expect(unfiltered).toMatchObject({ displayPrice: 80000, displayCondition: 'used' });
  });

  it('treats a null base condition as new for availability', async () => {
    const emptyQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: []; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    emptyQuery.select.mockReturnValue(emptyQuery);
    emptyQuery.eq.mockReturnValue(emptyQuery);
    emptyQuery.in.mockReturnValue(emptyQuery);
    emptyQuery.order.mockReturnValue(emptyQuery);
    const supabase = { rpc: vi.fn(async () => await emptyQuery), from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;
    const product = { id: 'legacy-phone', condition: null, price: 50000, manage_stock: false };

    const [asNew] = await hydrateSearchProductAvailability([product], supabase, 'merchant-1', 'new');
    const [asUsed] = await hydrateSearchProductAvailability([product], supabase, 'merchant-1', 'used');

    expect(asNew).toMatchObject({ basePurchasable: true, displayPrice: 50000, displayCondition: 'new' });
    expect(asUsed).toMatchObject({ basePurchasable: false });
  });

  it('keeps base stock for its own condition but not alternate offers', async () => {
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; condition: string; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [
          { product_id: 'base-phone', condition: 'used', stock_quantity: 0 },
        ], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    offerQuery.order.mockReturnValue(offerQuery);
    const supabase = { rpc: vi.fn(async (name: string) => name === 'get_mcp_search_product_offers' ? await offerQuery : { data: [], error: null }), from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;
    const products = [{ id: 'base-phone', condition: 'new', manage_stock: true,
      has_condition_offers: true, stock_quantity: 3 }];

    const [base] = await hydrateSearchProductAvailability(products, supabase, 'merchant-1', 'new');
    const [alternate] = await hydrateSearchProductAvailability(products, supabase, 'merchant-1', 'used');

    expect(base.stockSummary).toMatchObject({ inStock: true, level: 'Last Units' });
    expect(alternate.stockSummary).toMatchObject({ inStock: false, level: 'Out of Stock' });
  });

  it('does not claim new-option stock for a sold-out used-condition search', async () => {
    const rpc = vi.fn(async (name: string) => name === 'get_mcp_search_product_variants' ? ({ data: [
      { product_id: 'mixed-phone', condition: 'new', attributes: { storage: '128GB' }, stock_quantity: 2 },
      { product_id: 'mixed-phone', condition: 'uk_used', attributes: { storage: '64GB' }, stock_quantity: 0 },
    ], error: null }) : await offerQuery);
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; condition: string; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [
          { product_id: 'mixed-phone', condition: 'new', stock_quantity: 3 },
          { product_id: 'mixed-phone', condition: 'used', stock_quantity: 0 },
        ], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    offerQuery.order.mockReturnValue(offerQuery);
    const supabase = { rpc, from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;

    const [used] = await hydrateSearchProductAvailability([
      { id: 'mixed-phone', condition: 'new', manage_stock: true, has_variants: true,
        has_condition_offers: true, stock_quantity: 5 },
    ], supabase, 'merchant-1', 'UK Used');

    expect(used.stockSummary).toMatchObject({ inStock: false, level: 'Out of Stock' });
    expect(used.availableVariants).toEqual([]);
    expect(rpc).toHaveBeenCalledWith('get_mcp_search_product_offers', {
      p_product_ids: ['mixed-phone'], p_merchant_id: 'merchant-1',
    });
  });

  it('hydrates public offer compare-at price and explicit lookup status', async () => {
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; condition: string; price: number; compare_at_price: number; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [
          { product_id: 'offer-phone', condition: 'used', price: 80000, compare_at_price: 95000, stock_quantity: 2 },
        ], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    offerQuery.order.mockReturnValue(offerQuery);
    const result = await hydrateSearchProductAvailability([
      { id: 'offer-phone', condition: 'new', price: 100000, manage_stock: true,
        has_condition_offers: true, stock_quantity: 0 },
    ], { rpc: vi.fn(async () => await offerQuery), from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient, 'merchant-1', 'used');

    expect(result[0]).toMatchObject({
      displayPrice: 80000,
      availableOffers: [{ price: 80000, compare_at_price: 95000 }],
      optionsLookupFailed: false,
      offerLookupStatus: 'available',
      variantLookupStatus: 'not_required',
    });
  });

  it('reports each failed option source without discarding a successful source', async () => {
    const failedOffers = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: null; error: { message: string } }) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'offer lookup failed' } }).then(resolve),
    };
    failedOffers.select.mockReturnValue(failedOffers);
    failedOffers.eq.mockReturnValue(failedOffers);
    failedOffers.in.mockReturnValue(failedOffers);
    failedOffers.order.mockReturnValue(failedOffers);
    const rpc = vi.fn(async (name: string) => name === 'get_mcp_search_product_variants' ? ({ data: [
      { product_id: 'mixed-options', id: 'variant-1', attributes: { storage: '256GB' }, stock_quantity: 2 },
    ], error: null }) : await failedOffers);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const [result] = await hydrateSearchProductAvailability([
        { id: 'mixed-options', price: 100, manage_stock: true, has_variants: true,
          has_condition_offers: true, stock_quantity: 0 },
      ], { rpc, from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient, 'merchant-1');

      expect(result.optionsLookupFailed).toBe(true);
      expect(result.variantLookupFailed).toBe(false);
      expect(result.offerLookupFailed).toBe(true);
      expect(result.variantLookupStatus).toBe('available');
      expect(result.offerLookupStatus).toBe('failed');
      expect(result.availableVariants).toEqual([
        { product_id: 'mixed-options', id: 'variant-1', attributes: { storage: '256GB' }, stock_quantity: 2 },
      ]);
      expect(result.availableOffers).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it('uses stocked child variants and offers instead of zero parent stock', async () => {
    const rpc = vi.fn(async (name: string) => name === 'get_mcp_search_product_variants' ? ({ data: [
          { product_id: 'variant-phone', attributes: { storage: '64GB' }, stock_quantity: 0 },
          { product_id: 'variant-phone', attributes: { storage: '128GB' }, stock_quantity: 2 },
        ], error: null }) : await offerQuery);
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [{ product_id: 'offer-phone', stock_quantity: 1 }], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    offerQuery.order.mockReturnValue(offerQuery);
    const supabase = { rpc, from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;

    const result = await hydrateSearchProductAvailability([
      { id: 'variant-phone', manage_stock: true, has_variants: true, stock_quantity: 0 },
      { id: 'offer-phone', manage_stock: true, has_condition_offers: true, stock_quantity: 0 },
    ], supabase, 'merchant-1');

    expect(result[0].stockSummary.inStock).toBe(true);
    expect(result[0].availableVariants).toEqual([
      { product_id: 'variant-phone', attributes: { storage: '128GB' }, stock_quantity: 2 },
    ]);
    expect(result[1].stockSummary.inStock).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('get_mcp_search_product_variants', {
      p_product_ids: ['variant-phone'], p_merchant_id: 'merchant-1',
    });
    expect(rpc).toHaveBeenCalledWith('get_mcp_search_product_offers', {
      p_product_ids: ['offer-phone'], p_merchant_id: 'merchant-1',
    });
  });

  it('leaves tracked option availability unconfirmed when lookup fails', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: 'unavailable' } })), from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await hydrateSearchProductAvailability([
        { id: 'variant-phone', price: 80000, manage_stock: true, has_variants: true, stock_quantity: 0 },
      ], supabase, 'merchant-1');
      expect(result[0].stockSummary).toMatchObject({ confidence: 'unconfirmed', inStock: null });
      expect(result[0].availableVariants).toEqual([]);
      expect(result[0].displayPrice).toBeNull();
      expect(selectSearchProductsByPrice(result, { max_price: 100000 }, 20)).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it('does not substitute the parent price when an offer-only lookup fails', async () => {
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: null; error: { message: string } }) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'unavailable' } }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    offerQuery.order.mockReturnValue(offerQuery);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await hydrateSearchProductAvailability([
        { id: 'offer-phone', condition: 'new', price: 80000, manage_stock: true,
          has_condition_offers: true, stock_quantity: 0 },
      ], { rpc: vi.fn(async () => await offerQuery), from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient, 'merchant-1');
      expect(result[0].displayPrice).toBeNull();
      expect(selectSearchProductsByPrice(result, { max_price: 100000 }, 20)).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it('preserves the out-of-stock first offer through hydration into selection', async () => {
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; condition: string; price: number; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [
          { product_id: 'dup-phone', condition: 'used', price: 400, stock_quantity: 0 },
          { product_id: 'dup-phone', condition: 'used', price: 450, stock_quantity: 1 },
        ], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    offerQuery.order.mockReturnValue(offerQuery);
    const [row] = await hydrateSearchProductAvailability([{
      id: 'dup-phone', condition: 'new', price: 500, manage_stock: true,
      has_condition_offers: true, stock_quantity: 0,
      discovery_metadata: { product_type: 'smartphone' },
    }], { rpc: vi.fn(async () => await offerQuery), from: vi.fn(emptyPolicyFrom) } as unknown as SupabaseClient, 'merchant-1');

    // The first row survives hydration so selection's first-row dedupe sees
    // the same row the PDP resolves; the later in-stock duplicate stays hidden.
    expect(row.availableOffers).toHaveLength(2);
    expect(selectStructuredDiscoveryOffer(row, { alternatives: [{}] })).toBeUndefined();
  });

});
