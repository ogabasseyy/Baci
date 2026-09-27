import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hydrateSearchProductAvailability } from './search-product-availability';

describe('hydrateSearchProductAvailability', () => {
  it('uses the purchasable price for the requested condition', async () => {
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; condition: string; price: number; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [
          { product_id: 'priced-phone', condition: 'used', price: 80000, stock_quantity: 2 },
        ], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    const supabase = { from: vi.fn(() => offerQuery) } as unknown as SupabaseClient;
    const product = { id: 'priced-phone', condition: 'new', price: 100000,
      manage_stock: true, has_condition_offers: true, stock_quantity: 3 };

    const [base] = await hydrateSearchProductAvailability([product], supabase, 'merchant-1', 'new');
    const [used] = await hydrateSearchProductAvailability([product], supabase, 'merchant-1', 'used');

    expect(base).toMatchObject({ displayPrice: 100000, stockSummary: { inStock: true } });
    expect(used).toMatchObject({ displayPrice: 80000, stockSummary: { inStock: true } });
  });

  it('keeps base stock for its own condition but not alternate offers', async () => {
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; condition: string; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [
          { product_id: 'base-phone', condition: 'used', stock_quantity: 0 },
        ], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    const supabase = { from: vi.fn(() => offerQuery) } as unknown as SupabaseClient;
    const products = [{ id: 'base-phone', condition: 'new', manage_stock: true,
      has_condition_offers: true, stock_quantity: 3 }];

    const [base] = await hydrateSearchProductAvailability(products, supabase, 'merchant-1', 'new');
    const [alternate] = await hydrateSearchProductAvailability(products, supabase, 'merchant-1', 'used');

    expect(base.stockSummary).toMatchObject({ inStock: true, level: 'Last Units' });
    expect(alternate.stockSummary).toMatchObject({ inStock: false, level: 'Out of Stock' });
  });

  it('does not claim new-option stock for a sold-out used-condition search', async () => {
    const rpc = vi.fn(async () => ({ data: [
      { product_id: 'mixed-phone', condition: 'new', attributes: { storage: '128GB' }, stock_quantity: 2 },
      { product_id: 'mixed-phone', condition: 'uk_used', attributes: { storage: '64GB' }, stock_quantity: 0 },
    ], error: null }));
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; condition: string; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [
          { product_id: 'mixed-phone', condition: 'new', stock_quantity: 3 },
          { product_id: 'mixed-phone', condition: 'used', stock_quantity: 0 },
        ], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    const supabase = { rpc, from: vi.fn(() => offerQuery) } as unknown as SupabaseClient;

    const [used] = await hydrateSearchProductAvailability([
      { id: 'mixed-phone', condition: 'new', manage_stock: true, has_variants: true,
        has_condition_offers: true, stock_quantity: 5 },
    ], supabase, 'merchant-1', 'UK Used');

    expect(used.stockSummary).toMatchObject({ inStock: false, level: 'Out of Stock' });
    expect(used.availableVariants).toEqual([]);
    expect(offerQuery.select).toHaveBeenCalledWith('product_id, condition, price, stock_quantity');
  });

  it('uses stocked child variants and offers instead of zero parent stock', async () => {
    const rpc = vi.fn(async () => ({ data: [
          { product_id: 'variant-phone', attributes: { storage: '64GB' }, stock_quantity: 0 },
          { product_id: 'variant-phone', attributes: { storage: '128GB' }, stock_quantity: 2 },
        ], error: null }));
    const offerQuery = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(),
      then: (resolve: (value: { data: Array<{ product_id: string; stock_quantity: number }>; error: null }) => unknown) =>
        Promise.resolve({ data: [{ product_id: 'offer-phone', stock_quantity: 1 }], error: null }).then(resolve),
    };
    offerQuery.select.mockReturnValue(offerQuery);
    offerQuery.eq.mockReturnValue(offerQuery);
    offerQuery.in.mockReturnValue(offerQuery);
    const supabase = { rpc, from: vi.fn(() => offerQuery) } as unknown as SupabaseClient;

    const result = await hydrateSearchProductAvailability([
      { id: 'variant-phone', manage_stock: true, has_variants: true, stock_quantity: 0 },
      { id: 'offer-phone', manage_stock: true, has_condition_offers: true, stock_quantity: 0 },
    ], supabase, 'merchant-1');

    expect(result[0].stockSummary.inStock).toBe(true);
    expect(result[0].availableVariants).toEqual([
      { product_id: 'variant-phone', attributes: { storage: '128GB' }, stock_quantity: 2 },
    ]);
    expect(result[1].stockSummary.inStock).toBe(true);
    expect(offerQuery.in).toHaveBeenCalledWith('product_id', ['offer-phone']);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('leaves tracked option availability unconfirmed when lookup fails', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: 'unavailable' } })) } as unknown as SupabaseClient;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await hydrateSearchProductAvailability([
        { id: 'variant-phone', manage_stock: true, has_variants: true, stock_quantity: 0 },
      ], supabase, 'merchant-1');
      expect(result[0].stockSummary).toMatchObject({ confidence: 'unconfirmed', inStock: null });
      expect(result[0].availableVariants).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });
});
