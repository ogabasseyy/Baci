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
  it('does not advertise a parent price when option lookup fails without a budget', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      fetchPage: async (offset) => offset === 0
        ? [candidate('phone-with-unavailable-option-data', {
            price: 80, manage_stock: true, has_variants: true,
          })]
        : [],
      fetchVariants: async () => null,
      fetchOffers: async () => [],
    });

    expect(result).toEqual([]);
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
        { product_id: 'phone-with-affordable-offer', condition: 'new', price: 90, stock_quantity: 2 },
        { product_id: 'phone-with-affordable-offer', condition: 'used', price: 70, stock_quantity: 1 },
        { product_id: 'phone-with-affordable-offer', price: 50, stock_quantity: 0 },
      ],
    });

    expect(result.map((product) => product.recommendationPrice)).toEqual([70]);
    expect(result.map((product) => product.recommendationCondition)).toEqual(['used']);
  });

  it('uses stocked base price for an offer-only product when alternate offers exceed budget', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      budget: 100,
      fetchPage: async (offset) => offset === 0
        ? [candidate('phone-with-stocked-base-offer', {
            name: 'Phone', price: 80, stock_quantity: 3, manage_stock: true,
            has_condition_offers: true,
          })]
        : [],
      fetchVariants: async () => [],
      fetchOffers: async () => [
        { product_id: 'phone-with-stocked-base-offer', price: 120, stock_quantity: 2 },
        { product_id: 'phone-with-stocked-base-offer', price: 60, stock_quantity: 0 },
      ],
    });

    expect(result.map((product) => ({
      id: product.id,
      price: product.recommendationPrice,
    }))).toEqual([{ id: 'phone-with-stocked-base-offer', price: 80 }]);
  });

  it('keeps an untracked offer-only base price eligible when alternate offers exceed budget', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      budget: 100,
      fetchPage: async (offset) => offset === 0
        ? [candidate('untracked-phone-with-base-offer', {
            name: 'Phone', price: 80, manage_stock: false, has_condition_offers: true,
          })]
        : [],
      fetchVariants: async () => [],
      fetchOffers: async () => [
        { product_id: 'untracked-phone-with-base-offer', price: 120, stock_quantity: null },
      ],
    });

    expect(result.map((product) => ({
      id: product.id,
      price: product.recommendationPrice,
    }))).toEqual([{ id: 'untracked-phone-with-base-offer', price: 80 }]);
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

  it('hydrates untracked variants to recommend a cheaper option within budget', async () => {
    const fetchVariants = vi.fn(async () => [
      { product_id: 'untracked-phone', price_override: 90, stock_quantity: null },
    ]);
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      budget: 100,
      fetchPage: async (offset) => offset === 0
        ? [candidate('untracked-phone', {
            name: 'Phone', price: 180, manage_stock: false, has_variants: true,
          })]
        : [],
      fetchVariants,
      fetchOffers: async () => [],
    });

    expect(fetchVariants).toHaveBeenCalledWith(['untracked-phone']);
    expect(result.map((product) => ({
      id: product.id,
      price: product.recommendationPrice,
    }))).toEqual([{ id: 'untracked-phone', price: 90 }]);
  });

  it('derives the no-budget price from untracked option prices', async () => {
    const fetchVariants = vi.fn(async () => [
      { product_id: 'untracked-phone-without-budget', price_override: 90, stock_quantity: null },
    ]);
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      fetchPage: async (offset) => offset === 0
        ? [candidate('untracked-phone-without-budget', {
            name: 'Phone', price: 180, manage_stock: false, has_variants: true,
          })]
        : [],
      fetchVariants,
      fetchOffers: async () => [],
    });

    expect(fetchVariants).toHaveBeenCalledWith(['untracked-phone-without-budget']);
    expect(result.map((product) => ({
      id: product.id,
      price: product.recommendationPrice,
    }))).toEqual([{ id: 'untracked-phone-without-budget', price: 90 }]);
  });

  it('does not advertise an untracked parent price when every variant exceeds budget', async () => {
    const result = await selectRecommendedProducts({
      keywords: ['phone'],
      budget: 100,
      fetchPage: async (offset) => offset === 0
        ? [candidate('untracked-expensive-phone', {
            name: 'Phone', price: 80, manage_stock: false, has_variants: true,
          })]
        : [],
      fetchVariants: async () => [
        { product_id: 'untracked-expensive-phone', price_override: 120, stock_quantity: null },
      ],
      fetchOffers: async () => [],
    });

    expect(result).toEqual([]);
  });

});
