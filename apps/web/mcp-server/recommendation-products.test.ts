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

  it('derives the displayed price from the lowest stocked option without a budget', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      fetchPage: async (offset) => offset === 0
        ? [candidate('phone-with-options', {
            name: 'Phone', price: 180, manage_stock: true, has_variants: true,
          })]
        : [],
      fetchVariants: async () => [
        { product_id: 'phone-with-options', price_override: 130, stock_quantity: 2 },
        { product_id: 'phone-with-options', price_override: 100, stock_quantity: 1 },
        { product_id: 'phone-with-options', price_override: 80, stock_quantity: 0 },
      ],
      fetchOffers: async () => [],
    });

    expect(result.map((product) => product.recommendationPrice)).toEqual([100]);
  });

  it('ignores stocked offers without a price when deriving the displayed price', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      fetchPage: async (offset) => offset === 0
        ? [candidate('phone-with-offers', {
            name: 'Phone', price: 180, manage_stock: true, has_condition_offers: true,
          })]
        : [],
      fetchVariants: async () => [],
      fetchOffers: async () => [
        { product_id: 'phone-with-offers', price: null, stock_quantity: 1 },
        { product_id: 'phone-with-offers', price: 120, stock_quantity: 1 },
      ],
    });

    expect(result.map((product) => product.recommendationPrice)).toEqual([120]);
  });

  it('includes a parent above budget when a stocked variant is within budget', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      budget: 100,
      fetchPage: async (offset) => offset === 0
        ? [candidate('phone-with-cheaper-variant', {
            name: 'Phone', price: 180, manage_stock: true, has_variants: true,
          })]
        : [],
      fetchVariants: async () => [
        { product_id: 'phone-with-cheaper-variant', price_override: 90, stock_quantity: 2 },
        { product_id: 'phone-with-cheaper-variant', price_override: 120, stock_quantity: 3 },
      ],
      fetchOffers: async () => [],
    });

    expect(result.map((product) => ({
      id: product.id,
      price: product.recommendationPrice,
    }))).toEqual([{ id: 'phone-with-cheaper-variant', price: 90 }]);
  });

  it('continues past four pages of over-budget options to find an eligible product', async () => {
    const overBudgetRows = Array.from({ length: 128 }, (_, index) => candidate(`over-budget-phone-${index}`, {
      name: `Over budget phone ${index}`,
      price: 90,
      manage_stock: true,
      has_variants: true,
    }));
    const eligible = candidate('eligible-phone', {
      name: 'Eligible phone',
      price: 90,
      manage_stock: true,
      has_variants: true,
    });
    const rows = [...overBudgetRows, eligible];
    const fetchPage = vi.fn(async (offset: number, limit: number) => rows.slice(offset, offset + limit));

    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      budget: 100,
      fetchPage,
      fetchVariants: async (ids) => ids.map((id) => ({
        product_id: id,
        price_override: id === 'eligible-phone' ? 80 : 150,
        stock_quantity: 1,
      })),
      fetchOffers: async () => [],
    });

    expect(result.map((product) => product.id)).toEqual(['eligible-phone']);
    expect(fetchPage).toHaveBeenCalledWith(128, 32);
  });

  it('stops budgeted scans at the eight-page safety cap', async () => {
    const rows = Array.from({ length: 256 }, (_, index) => candidate(`over-budget-phone-${index}`, {
      name: `Over budget phone ${index}`,
      price: 90,
      manage_stock: true,
      has_variants: true,
    }));
    const fetchPage = vi.fn(async (offset: number, limit: number) => rows.slice(offset, offset + limit));

    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      budget: 100,
      fetchPage,
      fetchVariants: async (ids) => ids.map((id) => ({
        product_id: id,
        price_override: 150,
        stock_quantity: 1,
      })),
      fetchOffers: async () => [],
    });

    expect(result).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(8);
    expect(fetchPage).toHaveBeenLastCalledWith(224, 32);
  });
});
