import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildCompareIndexSections,
  COMPARE_HUB_PAGE_TOTAL_LINK_LIMIT,
  COMPARE_INDEX_CATEGORY_DISCOVERY_LIMIT,
  COMPARE_INDEX_CATEGORY_SCAN_LIMIT,
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

describe('compare index discovery', () => {
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

  it('caps compare links per category and across the full index', async () => {
    const sections = await buildCompareIndexSections({
      categories: [
        { name: 'Category A', slug: 'category-a' },
        { name: 'Category B', slug: 'category-b' },
      ],
      getCategoryPageData: vi.fn(async () => ({
        isCollection: false,
        isInactiveCategory: false,
        products: makeProducts(4),
      })),
      linksPerCategoryLimit: 3,
      pathPrefix: '/demo-store',
      storeUrl: 'https://store.test',
      totalLinkLimit: 4,
    });

    expect(sections.map((section) => section.links.length)).toEqual([3, 1]);
    expect(sections[0]?.links[0]).toEqual({
      href: '/demo-store/category-a/compare/product-a-vs-product-b',
      label: 'Compare Product A with Product B',
    });
  });

  it('scans bounded categories before applying the total link limit', async () => {
    const categories = Array.from({ length: 6 }, (_, index) => ({
      name: `Category ${index}`,
      slug: `category-${index}`,
    }));
    const getCategoryPageData = vi.fn(async () => ({
      isCollection: false,
      isInactiveCategory: false,
      products: makeProducts(),
    }));

    const sections = await buildCompareIndexSections({
      categories,
      concurrency: 2,
      getCategoryPageData,
      linksPerCategoryLimit: 1,
      storeUrl: 'https://store.test',
      totalLinkLimit: 1,
    });

    expect(getCategoryPageData).toHaveBeenCalledTimes(categories.length);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.links).toHaveLength(1);
  });

  it('filters inactive category rows before applying the raw scan cap', async () => {
    const getCategoryPageData = vi.fn(async () => ({
      isCollection: false,
      isInactiveCategory: false,
      products: makeProducts(),
    }));

    const sections = await buildCompareIndexSections({
      categories: [
        { name: 'Inactive 1', slug: 'inactive-1', is_active: false },
        { name: 'Inactive 2', slug: 'inactive-2', is_active: false },
        { name: 'Working', slug: 'working', is_active: true },
      ],
      categoryScanLimit: 1,
      concurrency: 1,
      getCategoryPageData,
      storeUrl: 'https://store.test',
    });

    expect(getCategoryPageData).toHaveBeenCalledTimes(1);
    expect(getCategoryPageData).toHaveBeenCalledWith(
      'working',
      0,
      COMPARE_INDEX_PRODUCTS_PER_CATEGORY_LIMIT
    );
    expect(sections[0]?.categorySlug).toBe('working');
  });

  it('scans past non-publishing categories until a populated section is found', async () => {
    const categories = [
      ...Array.from(
        { length: COMPARE_INDEX_CATEGORY_DISCOVERY_LIMIT },
        (_, index) => ({
          name: `Empty ${index}`,
          slug: `empty-${index}`,
        })
      ),
      { name: 'Working', slug: 'working' },
    ];
    const getCategoryPageData = vi.fn(async (categorySlug: string) => ({
      isCollection: false,
      isInactiveCategory: false,
      products: categorySlug === 'working' ? makeProducts() : [],
    }));

    const sections = await buildCompareIndexSections({
      categories,
      categoryLimit: 1,
      concurrency: 1,
      getCategoryPageData,
      storeUrl: 'https://store.test',
    });

    expect(getCategoryPageData).toHaveBeenCalledTimes(
      COMPARE_INDEX_CATEGORY_DISCOVERY_LIMIT + 1
    );
    expect(sections).toEqual([
      {
        categoryName: 'Working',
        categorySlug: 'working',
        links: [
          {
            href: '/working/compare/product-a-vs-product-b',
            label: 'Compare Product A with Product B',
          },
        ],
      },
    ]);
  });

  it('caps raw category scans when no categories can publish links', async () => {
    const categories = Array.from(
      { length: COMPARE_INDEX_CATEGORY_SCAN_LIMIT + 5 },
      (_, index) => ({
        name: `Empty ${index}`,
        slug: `empty-${index}`,
      })
    );
    const getCategoryPageData = vi.fn(async () => ({
      isCollection: false,
      isInactiveCategory: false,
      products: [],
    }));

    const sections = await buildCompareIndexSections({
      categories,
      categoryScanLimit: 5,
      concurrency: 2,
      getCategoryPageData,
      storeUrl: 'https://store.test',
    });

    expect(sections).toEqual([]);
    expect(getCategoryPageData).toHaveBeenCalledTimes(5);
    expect(getCategoryPageData).not.toHaveBeenCalledWith(
      'empty-5',
      0,
      COMPARE_INDEX_PRODUCTS_PER_CATEGORY_LIMIT
    );
  });

  it('enforces the configured product cap even when category data returns extra rows', async () => {
    const sections = await buildCompareIndexSections({
      categories: [{ name: 'Category A', slug: 'category-a' }],
      getCategoryPageData: vi.fn(async () => ({
        isCollection: false,
        isInactiveCategory: false,
        products: makeProducts(3),
      })),
      productLimit: 2,
      storeUrl: 'https://store.test',
    });

    expect(sections[0]?.links).toEqual([
      {
        href: '/category-a/compare/product-a-vs-product-b',
        label: 'Compare Product A with Product B',
      },
    ]);
  });

  it('skips categories that cannot publish compare index links', async () => {
    const sections = await buildCompareIndexSections({
      categories: [
        { name: 'Missing', slug: 'missing' },
        { name: 'Collection', slug: 'collection' },
        { name: 'Inactive', slug: 'inactive' },
        { name: 'Without links', slug: 'without-links' },
        { name: 'Working', slug: 'working' },
      ],
      getCategoryPageData: vi.fn((categorySlug: string) => {
        if (categorySlug === 'missing') {
          return Promise.resolve(null);
        }

        if (categorySlug === 'collection') {
          return Promise.resolve({
            isCollection: true,
            products: makeProducts(),
          });
        }

        if (categorySlug === 'inactive') {
          return Promise.resolve({
            isCollection: false,
            isInactiveCategory: true,
            products: makeProducts(),
          });
        }

        return Promise.resolve({
          isCollection: false,
          isInactiveCategory: false,
          products: categorySlug === 'without-links' ? [] : makeProducts(),
        });
      }),
      storeUrl: 'https://store.test',
    });

    expect(sections).toEqual([
      {
        categoryName: 'Working',
        categorySlug: 'working',
        links: [
          {
            href: '/working/compare/product-a-vs-product-b',
            label: 'Compare Product A with Product B',
          },
        ],
      },
    ]);
  });

  it('skips rejected category loads while keeping later sections', async () => {
    const sections = await buildCompareIndexSections({
      categories: [
        { name: 'Broken', slug: 'broken' },
        { name: 'Working', slug: 'working' },
      ],
      getCategoryPageData: vi.fn((categorySlug: string) => {
        if (categorySlug === 'broken') {
          return Promise.reject(new Error('Category load failed'));
        }

        return Promise.resolve({
          isCollection: false,
          isInactiveCategory: false,
          products: makeProducts(),
        });
      }),
      storeUrl: 'https://store.test',
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.categorySlug).toBe('working');
  });
});
