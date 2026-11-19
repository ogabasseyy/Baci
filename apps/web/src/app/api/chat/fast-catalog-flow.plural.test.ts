import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ categories: vi.fn(), products: vi.fn() }));
vi.mock('./fast-catalog-data', () => ({
  loadFastCatalogCategories: mocks.categories,
  loadFastCatalogProducts: mocks.products,
}));

import { tryFastCatalogChat } from './fast-catalog-flow';

const tenant = {
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  businessName: 'Ogabassey',
  currencyCode: 'NGN',
  agenticCheckoutEnabled: true,
  priceNegotiationEnabled: true,
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('tryFastCatalogChat plural device queries', () => {
  it('answers plural macbooks below 2m through the catalog search flow', async () => {
    mocks.categories.mockResolvedValue([
      { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
      { id: 'laptops', name: 'Laptops', slug: 'laptops' },
    ]);
    mocks.products.mockResolvedValue([
      {
        id: 'mac-1',
        name: 'Apple MacBook Air M2',
        slug: 'apple-macbook-air-m2',
        brand: 'Apple',
        category: 'Laptops',
        description: null,
        image_url: null,
        price: 1_450_000,
        status: 'active',
        stock: 2,
        manage_stock: false,
        has_variants: false,
      },
    ]);

    const result = await tryFastCatalogChat({
      messages: [{ role: 'user', content: 'macbooks below 2m' }],
      tenant,
      signal: new AbortController().signal,
    });

    expect(result?.events[0]?.products[0]?.name).toBe('Apple MacBook Air M2');
    expect(mocks.products).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({
        categoryId: 'laptops',
        query: 'MacBook',
        maxPrice: 2_000_000,
        exclusiveMaxPrice: true,
      })
    );
  });
});
