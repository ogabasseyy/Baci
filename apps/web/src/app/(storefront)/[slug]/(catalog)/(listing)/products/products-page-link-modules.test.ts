import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedProductSemanticInventory } from '@/lib/storefront-product/get-cached-product-semantic-inventory';
import {
  loadProductsPageLinkModules,
  PRODUCTS_PAGE_COMPARE_MODULE_CATEGORY_LIMIT,
} from './products-page-link-modules';

vi.mock(
  '@/lib/storefront-product/get-cached-product-semantic-inventory',
  () => ({
    getCachedProductSemanticInventory: vi.fn(),
  })
);

const mockedInventory = vi.mocked(getCachedProductSemanticInventory);

describe('loadProductsPageLinkModules', () => {
  beforeEach(() => {
    mockedInventory.mockReset();
  });

  it('builds maintained compare modules while omitting category and pagination modules', async () => {
    mockedInventory.mockResolvedValue([
      {
        slug: 'xiaomi-13t',
        name: 'Xiaomi 13T',
        brand: 'Xiaomi',
        category_slug: 'smartphones',
        price: 450_000,
        product_key_specs: {
          chipset: 'Dimensity 8200 Ultra',
          ram_gb: 12,
          storage_gb: 256,
        },
      },
      {
        slug: 'samsung-galaxy-s24-ultra',
        name: 'Samsung Galaxy S24 Ultra',
        brand: 'Samsung',
        category_slug: 'smartphones',
        price: 1_550_000,
        product_key_specs: {
          chipset: 'Snapdragon 8 Gen 3',
          ram_gb: 16,
          storage_gb: 512,
        },
      },
    ]);

    const modules = await loadProductsPageLinkModules({
      baseUrl: 'https://ogabassey.com',
      merchantId: 'merchant-1',
      productTotalPages: 3,
      categories: [
        {
          id: 'cat-1',
          slug: 'smartphones',
          canonicalSlug: 'smartphones',
          name: 'Smartphones',
          description: null,
          image_url: null,
          is_active: true,
          parent_id: null,
          product_count: 25,
        },
      ],
    });

    expect(modules.map((module) => module.id)).toEqual(['compare-modules']);
    expect(modules.some((module) => module.id === 'catalog-categories')).toBe(
      false
    );
    expect(modules.some((module) => module.id === 'category-pages')).toBe(
      false
    );
    expect(modules.some((module) => module.id === 'catalog-pages')).toBe(false);
    expect(
      modules.flatMap((module) => module.items).map((item) => item.href)
    ).toContain('/smartphones/compare/samsung-galaxy-s24-ultra-vs-xiaomi-13t');
  });

  it('returns empty modules when category inventory loading fails and no compare links are formed', async () => {
    mockedInventory.mockRejectedValue(new Error('inventory unavailable'));

    const modules = await loadProductsPageLinkModules({
      baseUrl: 'https://ogabassey.com',
      merchantId: 'merchant-1',
      productTotalPages: 2,
      categories: [
        {
          id: 'cat-1',
          slug: 'smartphones',
          canonicalSlug: 'smartphones',
          name: 'Smartphones',
          description: null,
          image_url: null,
          is_active: true,
          parent_id: null,
          product_count: 1,
        },
      ],
    });

    expect(modules.some((module) => module.id === 'compare-modules')).toBe(
      false
    );
    expect(modules.some((module) => module.id === 'catalog-categories')).toBe(
      false
    );
  });

  it('caps compare inventory loading while keeping categories safe', async () => {
    mockedInventory.mockResolvedValue([]);
    const categories = Array.from(
      { length: PRODUCTS_PAGE_COMPARE_MODULE_CATEGORY_LIMIT + 2 },
      (_, index) => ({
        id: `cat-${index}`,
        slug: `category-${index}`,
        canonicalSlug: `category-${index}`,
        name: `Category ${index}`,
        description: null,
        image_url: null,
        is_active: true,
        parent_id: null,
        product_count: 12,
      })
    );

    await loadProductsPageLinkModules({
      baseUrl: 'https://ogabassey.com',
      merchantId: 'merchant-1',
      productTotalPages: 1,
      categories,
    });

    expect(mockedInventory).toHaveBeenCalledTimes(
      PRODUCTS_PAGE_COMPARE_MODULE_CATEGORY_LIMIT
    );
  });
});
