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

describe('selectRecommendedProducts paging', () => {
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
