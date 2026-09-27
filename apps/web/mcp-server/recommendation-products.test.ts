import { describe, expect, it, vi } from 'vitest';
import { selectRecommendedProducts } from './recommendation-products';

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    description: null,
    manage_stock: false,
    price: 100,
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

  it('excludes a product when only its sold-out variant fits the budget', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      budget: 100,
      fetchPage: async (offset) => offset === 0
        ? [candidate('phone-with-expensive-stocked-variant', {
            name: 'Phone', price: 80, manage_stock: true, has_variants: true,
          })]
        : [],
      fetchVariants: async () => [
        { product_id: 'phone-with-expensive-stocked-variant', price_override: 60, stock_quantity: 0 },
        { product_id: 'phone-with-expensive-stocked-variant', price_override: 120, stock_quantity: 2 },
      ],
      fetchOffers: async () => [],
    });

    expect(result).toEqual([]);
  });

  it('recommends the lowest priced stocked option within the budget', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      budget: 100,
      fetchPage: async (offset) => offset === 0
        ? [candidate('phone-with-affordable-offer', {
            name: 'Phone', price: 80, manage_stock: true, has_condition_offers: true,
          })]
        : [],
      fetchVariants: async () => [],
      fetchOffers: async () => [
        { product_id: 'phone-with-affordable-offer', price: 90, stock_quantity: 2 },
        { product_id: 'phone-with-affordable-offer', price: 70, stock_quantity: 1 },
        { product_id: 'phone-with-affordable-offer', price: 50, stock_quantity: 0 },
      ],
    });

    expect(result.map((product) => product.recommendationPrice)).toEqual([70]);
  });
});
