import { describe, expect, it, vi } from 'vitest';
import { selectRecommendedProducts } from './recommendation-products';

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    description: null,
    manage_stock: false,
    stock_quantity: 0,
    has_variants: false,
    has_condition_offers: false,
    ...overrides,
  };
}

describe('selectRecommendedProducts', () => {
  it('scans past a full page of sold-out options for stocked matches', async () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, index) => candidate(`other-${index}`)),
      ...Array.from({ length: 28 }, (_, index) => candidate(`sold-out-phone-${index}`, {
        manage_stock: true, has_variants: true,
      })),
      candidate('stocked-variant-phone', { manage_stock: true, has_variants: true }),
      candidate('stocked-offer-phone', { manage_stock: true, has_condition_offers: true }),
    ];
    const fetchPage = vi.fn(async (offset: number, limit: number) => rows.slice(offset, offset + limit));
    const fetchVariants = vi.fn(async (ids: string[]) => ids.map((id) => ({
      product_id: id,
      stock_quantity: id === 'stocked-variant-phone' ? 2 : 0,
    })));
    const fetchOffers = vi.fn(async () => [{ product_id: 'stocked-offer-phone', stock_quantity: 1 }]);

    const result = await selectRecommendedProducts({
      keywords: ['phone'], fetchPage, fetchVariants, fetchOffers,
    });

    expect(result.map((product) => product.id)).toEqual(['stocked-variant-phone', 'stocked-offer-phone']);
    expect(fetchPage).toHaveBeenCalledWith(0, 32);
    expect(fetchPage).toHaveBeenCalledWith(32, 32);
  });

  it('keeps availability unconfirmed when an option lookup fails', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      fetchPage: async (offset) => offset === 0
        ? [candidate('phone-with-unavailable-stock-data', { manage_stock: true, has_variants: true })]
        : [],
      fetchVariants: async () => null,
      fetchOffers: async () => [],
    });

    expect(result.map((product) => product.id)).toEqual(['phone-with-unavailable-stock-data']);
  });
});
