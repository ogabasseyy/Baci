import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hydrateSearchProductAvailability } from './search-product-availability';

describe('hydrateSearchProductAvailability', () => {
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
