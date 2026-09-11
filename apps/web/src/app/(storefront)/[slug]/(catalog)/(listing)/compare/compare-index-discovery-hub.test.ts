import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildCompareIndexSections,
  COMPARE_HUB_PAGE_TOTAL_LINK_LIMIT,
  COMPARE_INDEX_CATEGORY_DISCOVERY_LIMIT,
  COMPARE_INDEX_DISCOVERY_CONCURRENCY,
  COMPARE_INDEX_PRODUCTS_PER_CATEGORY_LIMIT,
  COMPARE_INDEX_TOTAL_LINK_LIMIT,
} = await import('./compare-index-discovery');

function makeProduct(index: number) {
  const letter = String.fromCharCode(65 + index);

  return {
    id: `product-${letter.toLowerCase()}`,
    name: `Product ${letter}`,
    slug: `product-${letter.toLowerCase()}`,
    brand: `Brand ${letter}`,
    category: 'Category',
    price: 1000 + index * 1000,
    product_key_specs: {
      chipset: `${letter}1`,
      ram_gb: 8 + index * 4,
      storage_gb: 128 + index * 128,
    },
  };
}

function makeProducts(count = 2) {
  return Array.from({ length: count }, (_item, index) => makeProduct(index));
}

describe('compare index hub discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the visible compare hub far below the 800-link discovery budget', () => {
    expect(COMPARE_HUB_PAGE_TOTAL_LINK_LIMIT).toBeLessThanOrEqual(24);
    expect(COMPARE_HUB_PAGE_TOTAL_LINK_LIMIT).toBeLessThan(
      COMPARE_INDEX_TOTAL_LINK_LIMIT
    );
  });

  it('bounds scanned category discovery and concurrent category data loads', async () => {
    const categories = Array.from(
      { length: COMPARE_INDEX_CATEGORY_DISCOVERY_LIMIT + 4 },
      (_, index) => ({
        name: `Category ${index}`,
        slug: `category-${index}`,
      })
    );
    let activeLoads = 0;
    let maxActiveLoads = 0;
    const getCategoryPageData = vi.fn(
      async (_categorySlug: string, _productOffset: number) => {
        activeLoads += 1;
        maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
        await Promise.resolve();

        activeLoads -= 1;

        return {
          isCollection: false,
          isInactiveCategory: false,
          products: makeProducts(),
        };
      }
    );

    await buildCompareIndexSections({
      categories,
      getCategoryPageData,
      storeUrl: 'https://store.test',
    });

    expect(getCategoryPageData).toHaveBeenCalledTimes(categories.length);
    expect(getCategoryPageData).toHaveBeenCalledWith(
      'category-0',
      0,
      COMPARE_INDEX_PRODUCTS_PER_CATEGORY_LIMIT
    );
    expect(maxActiveLoads).toBe(COMPARE_INDEX_DISCOVERY_CONCURRENCY);
  });

  it('discovers hub compare links from later products when the first few lack key specs', async () => {
    const products = [
      ...makeProducts(5).map((product) => ({
        ...product,
        product_key_specs: {},
      })),
      makeProduct(5),
      makeProduct(6),
    ];

    const truncated = await buildCompareIndexSections({
      categories: [{ name: 'Laptops', slug: 'laptops' }],
      getCategoryPageData: vi.fn(async () => ({
        isCollection: false,
        isInactiveCategory: false,
        products,
      })),
      linksPerCategoryLimit: 4,
      productLimit: 5,
      storeUrl: 'https://store.test',
      totalLinkLimit: 24,
    });
    const discovered = await buildCompareIndexSections({
      categories: [{ name: 'Laptops', slug: 'laptops' }],
      getCategoryPageData: vi.fn(async () => ({
        isCollection: false,
        isInactiveCategory: false,
        products,
      })),
      linksPerCategoryLimit: 4,
      productLimit: COMPARE_INDEX_PRODUCTS_PER_CATEGORY_LIMIT,
      storeUrl: 'https://store.test',
      totalLinkLimit: 24,
    });

    expect(truncated).toEqual([]);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.links.length).toBeGreaterThan(0);
    expect(discovered[0]?.links.length).toBeLessThanOrEqual(4);
  });
});
