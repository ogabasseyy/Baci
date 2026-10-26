import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCategoryScopedSemanticInventorySafely } from '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely';
import { buildInformationalClusterModel } from './build-informational-cluster-model';

vi.mock(
  '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely',
  () => ({ loadCategoryScopedSemanticInventorySafely: vi.fn() })
);

const mockLoadScopedInventory = vi.mocked(
  loadCategoryScopedSemanticInventorySafely
);

const smartphoneGuidePost = {
  slug: 'best-phones-in-nigeria',
  title: 'Best Phones in Nigeria for 2026',
  excerpt: 'Affordable Android and iPhone picks for buyers in Nigeria.',
  category: 'Smartphones',
  tags: ['budget', 'iphone', 'samsung'],
  keywords: ['android', 'battery', 'smartphones'],
  featured_image_url: null,
  published_at: '2026-04-10T09:00:00.000Z',
  reading_time_minutes: 6,
};

const smartphoneCategoryData = {
  merchant: {
    id: 'merchant-1',
    business_name: 'Ogabassey',
    slug: 'ogabassey',
  },
  category: {
    slug: 'smartphones',
    name: 'Smartphones',
  },
  products: [
    {
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      brand: 'Apple',
      price: 495_000,
      category_slug: 'smartphones',
      product_key_specs: {
        chipset: 'A19 Pro',
        ram_gb: 8,
        storage_gb: 256,
      },
    },
    {
      slug: 'samsung-galaxy-z-trifold',
      name: 'Samsung Galaxy Z TriFold',
      brand: 'Samsung',
      price: 480_000,
      category_slug: 'smartphones',
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 16,
        storage_gb: 512,
      },
    },
    {
      slug: 'galaxy-a56',
      name: 'Galaxy A56',
      brand: 'Samsung',
      price: 410_000,
      category_slug: 'smartphones',
      product_key_specs: {
        chipset: 'Exynos',
        ram_gb: 8,
        storage_gb: 128,
      },
    },
    {
      slug: 'iphone-15',
      name: 'iPhone 15',
      brand: 'Apple',
      price: 430_000,
      category_slug: 'smartphones',
      product_key_specs: {
        chipset: 'A17',
        ram_gb: 8,
        storage_gb: 128,
      },
    },
  ],
  isCollection: false,
};

describe('buildInformationalClusterModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds category, compare, price-band, and PDP links for a smartphone guide', async () => {
    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: smartphoneGuidePost,
      categoryDataOverride: smartphoneCategoryData,
    });

    expect(model?.primaryCategoryLink?.href).toBe(
      'https://ogabassey.com/smartphones'
    );
    expect(model?.commerceLinks.map((link) => link.href)).toContain(
      'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold'
    );
    expect(model?.featuredProducts[0]?.href).toBe(
      'https://ogabassey.com/smartphones/galaxy-a56'
    );
  });

  it('formats featured product prices with the storefront country currency', async () => {
    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: smartphoneGuidePost,
      categoryDataOverride: smartphoneCategoryData,
      countryCode: 'IN',
    });

    expect(model?.featuredProducts[0]?.description).toMatch(/₹|INR/);
    expect(model?.featuredProducts[0]?.description).not.toContain('₦');
  });

  it('falls back to Nigerian currency for featured product prices', async () => {
    const defaultModel = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: smartphoneGuidePost,
      categoryDataOverride: smartphoneCategoryData,
    });
    const explicitNigeriaModel = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: smartphoneGuidePost,
      categoryDataOverride: smartphoneCategoryData,
      countryCode: 'NG',
    });

    expect(defaultModel?.featuredProducts[0]?.description).toContain('₦');
    expect(defaultModel?.featuredProducts[0]?.description).not.toMatch(/₹|INR/);
    expect(explicitNigeriaModel?.featuredProducts[0]?.description).toContain(
      '₦'
    );
    expect(explicitNigeriaModel?.featuredProducts[0]?.description).not.toMatch(
      /₹|INR/
    );
  });

  it('returns null when the article category cannot be inferred', async () => {
    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: {
        slug: 'store-update',
        title: 'Store update',
        excerpt: 'New features this week.',
        category: 'News',
        tags: ['update'],
        keywords: ['launch'],
        featured_image_url: null,
        published_at: '2026-04-10T09:00:00.000Z',
        reading_time_minutes: 2,
      },
      categoryDataOverride: smartphoneCategoryData,
    });

    expect(model).toBeNull();
  });

  it('builds the model from the scoped semantic inventory when no override is supplied', async () => {
    mockLoadScopedInventory.mockResolvedValue({
      isCollection: false,
      categoryName: 'Smartphones',
      products: [
        {
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495_000,
          category_slug: 'smartphones',
          product_key_specs: { ram_gb: 8, storage_gb: 256 },
          condition: 'new',
          stock: 5,
        },
        {
          slug: 'galaxy-a56',
          name: 'Galaxy A56',
          brand: 'Samsung',
          price: 410_000,
          category_slug: 'smartphones',
          product_key_specs: { ram_gb: 8, storage_gb: 128 },
          condition: 'new',
          stock: 3,
        },
      ],
    });

    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: smartphoneGuidePost,
    });

    expect(mockLoadScopedInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: 'smartphones',
        merchantId: 'merchant-1',
        storeSlug: 'ogabassey',
      })
    );
    expect(model?.primaryCategoryLink?.href).toBe(
      'https://ogabassey.com/smartphones'
    );
    // cheapest in-stock product surfaces first
    expect(model?.featuredProducts[0]?.href).toBe(
      'https://ogabassey.com/smartphones/galaxy-a56'
    );
  });

  it('applies toCategoryInventoryProduct fallbacks for missing fields on the scoped path', async () => {
    mockLoadScopedInventory.mockResolvedValue({
      isCollection: false,
      categoryName: 'Smartphones',
      products: [
        {
          // category_slug, product_key_specs, condition and stock all absent
          slug: 'mystery-phone',
          name: 'Mystery Phone',
          brand: 'NoName',
          price: 100_000,
        },
      ],
    });

    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: smartphoneGuidePost,
    });

    // category_slug falls back to the inferred category slug (not the
    // slugless /products/ href), and null stock is treated as in-stock so the
    // product is still featured — matching the old getCachedCategoryPageData
    // normalization the swap must preserve.
    expect(model?.featuredProducts).toHaveLength(1);
    expect(model?.featuredProducts[0]?.href).toBe(
      'https://ogabassey.com/smartphones/mystery-phone'
    );
  });

  it('returns null when the scoped inventory resolves to a collection', async () => {
    mockLoadScopedInventory.mockResolvedValue({
      isCollection: true,
      categoryName: 'Smartphones',
      products: [],
    });

    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: smartphoneGuidePost,
    });

    expect(model).toBeNull();
  });

  it('links an Apple iPhone 15 Pro Max article to /smartphones/brands/apple and /smartphones/brands/apple/families/iphone-15 when eligible', async () => {
    const iphone15Post = {
      slug: 'iphone-15-pro-max-review',
      title: 'Apple iPhone 15 Pro Max Review: Best Flagship in Nigeria',
      excerpt: 'Everything you need to know about the iPhone 15 Pro Max.',
      category: 'Smartphones',
      tags: ['apple', 'iphone'],
      keywords: ['iphone 15 pro max', 'flagship'],
      featured_image_url: null,
      published_at: '2026-04-10T09:00:00.000Z',
      reading_time_minutes: 5,
    };

    const eligibleIphone15CategoryData = {
      category: { slug: 'smartphones', name: 'Smartphones' },
      products: [
        {
          slug: 'iphone-15-pro-max',
          name: 'iPhone 15 Pro Max',
          brand: 'Apple',
          price: 900_000,
          category_slug: 'smartphones',
          stock: 5,
          product_key_specs: { ram_gb: 8, storage_gb: 256 },
        },
        {
          slug: 'iphone-15-pro',
          name: 'iPhone 15 Pro',
          brand: 'Apple',
          price: 800_000,
          category_slug: 'smartphones',
          stock: 4,
          product_key_specs: { ram_gb: 8, storage_gb: 128 },
        },
        {
          slug: 'iphone-15',
          name: 'iPhone 15',
          brand: 'Apple',
          price: 650_000,
          category_slug: 'smartphones',
          stock: 3,
          product_key_specs: { ram_gb: 6, storage_gb: 128 },
        },
        {
          slug: 'iphone-14-pro',
          name: 'iPhone 14 Pro',
          brand: 'Apple',
          price: 600_000,
          category_slug: 'smartphones',
          stock: 2,
        },
        {
          slug: 'iphone-13',
          name: 'iPhone 13',
          brand: 'Apple',
          price: 450_000,
          category_slug: 'smartphones',
          stock: 2,
        },
      ],
      isCollection: false,
    };

    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: iphone15Post,
      categoryDataOverride: eligibleIphone15CategoryData,
    });

    const links = model?.commerceLinks.map((link) => link.href) ?? [];
    expect(links).toContain('https://ogabassey.com/smartphones/brands/apple');
    expect(links).toContain(
      'https://ogabassey.com/smartphones/brands/apple/families/iphone-15'
    );
  });

  it('does NOT link to /families/iphone-15 if < 3 iPhone 15 products are in stock', async () => {
    const iphone15Post = {
      slug: 'iphone-15-pro-max-review',
      title: 'Apple iPhone 15 Pro Max Review',
      excerpt: 'Everything you need to know about the iPhone 15 Pro Max.',
      category: 'Smartphones',
      tags: ['apple', 'iphone'],
      keywords: ['iphone 15 pro max'],
      featured_image_url: null,
      published_at: '2026-04-10T09:00:00.000Z',
      reading_time_minutes: 5,
    };

    // 5 Apple products (Apple brand hub eligible), but only 2 iPhone 15 products in stock (< 3 required)
    const lowStockIphone15CategoryData = {
      category: { slug: 'smartphones', name: 'Smartphones' },
      products: [
        {
          slug: 'iphone-15-pro-max',
          name: 'iPhone 15 Pro Max',
          brand: 'Apple',
          price: 900_000,
          category_slug: 'smartphones',
          stock: 5,
        },
        {
          slug: 'iphone-15-pro',
          name: 'iPhone 15 Pro',
          brand: 'Apple',
          price: 800_000,
          category_slug: 'smartphones',
          stock: 4,
        },
        {
          slug: 'iphone-14-pro',
          name: 'iPhone 14 Pro',
          brand: 'Apple',
          price: 600_000,
          category_slug: 'smartphones',
          stock: 2,
        },
        {
          slug: 'iphone-14',
          name: 'iPhone 14',
          brand: 'Apple',
          price: 500_000,
          category_slug: 'smartphones',
          stock: 2,
        },
        {
          slug: 'iphone-13',
          name: 'iPhone 13',
          brand: 'Apple',
          price: 450_000,
          category_slug: 'smartphones',
          stock: 1,
        },
      ],
      isCollection: false,
    };

    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: iphone15Post,
      categoryDataOverride: lowStockIphone15CategoryData,
    });

    const links = model?.commerceLinks.map((link) => link.href) ?? [];
    expect(links).toContain('https://ogabassey.com/smartphones/brands/apple');
    expect(links).not.toContain(
      'https://ogabassey.com/smartphones/brands/apple/families/iphone-15'
    );
  });

  it('avoids irrelevant destination mismatch: single-brand article never emits unrelated cross-brand product/brand comparisons', async () => {
    const singleBrandPost = {
      slug: 'apple-iphone-buyers-guide',
      title: 'Apple iPhone Buyers Guide',
      excerpt: 'Which iPhone is right for you in 2026?',
      category: 'Smartphones',
      tags: ['apple', 'iphone'],
      keywords: ['ios', 'apple'],
      featured_image_url: null,
      published_at: '2026-04-10T09:00:00.000Z',
      reading_time_minutes: 5,
    };

    // Category contains 1 Apple product (no specs to compare) and multiple Samsung/Xiaomi products
    const crossBrandCategoryData = {
      category: { slug: 'smartphones', name: 'Smartphones' },
      products: [
        {
          slug: 'iphone-15',
          name: 'iPhone 15',
          brand: 'Apple',
          price: 450_000,
          category_slug: 'smartphones',
          product_key_specs: null,
        },
        {
          slug: 'galaxy-s24',
          name: 'Galaxy S24',
          brand: 'Samsung',
          price: 500_000,
          category_slug: 'smartphones',
          product_key_specs: { ram_gb: 8, storage_gb: 256 },
        },
        {
          slug: 'galaxy-a55',
          name: 'Galaxy A55',
          brand: 'Samsung',
          price: 250_000,
          category_slug: 'smartphones',
          product_key_specs: { ram_gb: 8, storage_gb: 128 },
        },
        {
          slug: 'redmi-note-13',
          name: 'Redmi Note 13',
          brand: 'Xiaomi',
          price: 200_000,
          category_slug: 'smartphones',
          product_key_specs: { ram_gb: 8, storage_gb: 128 },
        },
      ],
      isCollection: false,
    };

    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: singleBrandPost,
      categoryDataOverride: crossBrandCategoryData,
    });

    const links = model?.commerceLinks.map((link) => link.href) ?? [];
    // Must NOT emit unrelated Galaxy S24 vs Galaxy A55 product comparison
    expect(links).not.toContain(
      'https://ogabassey.com/smartphones/compare/galaxy-a55-vs-galaxy-s24'
    );
    expect(links).not.toContain(
      'https://ogabassey.com/smartphones/compare/galaxy-s24-vs-galaxy-a55'
    );
    // Must NOT emit unrelated Samsung vs Xiaomi brand comparison
    expect(links).not.toContain(
      'https://ogabassey.com/smartphones/compare/samsung-vs-xiaomi'
    );
  });

  it('emits cross-brand comparisons when article explicitly covers both brands (e.g. iPhone vs Samsung)', async () => {
    const dualBrandPost = {
      slug: 'iphone-vs-samsung-flagship-showdown',
      title: 'Apple iPhone vs Samsung Galaxy Flagship Showdown',
      excerpt: 'Comparing Apple and Samsung flagships in Nigeria.',
      category: 'Smartphones',
      tags: ['apple', 'samsung', 'iphone', 'galaxy'],
      keywords: ['iphone', 'samsung', 'comparison'],
      featured_image_url: null,
      published_at: '2026-04-10T09:00:00.000Z',
      reading_time_minutes: 6,
    };

    const multiBrandCategoryData = {
      category: { slug: 'smartphones', name: 'Smartphones' },
      products: [
        {
          slug: 'iphone-15-pro',
          name: 'iPhone 15 Pro',
          brand: 'Apple',
          price: 800_000,
          category_slug: 'smartphones',
          product_key_specs: { chipset: 'A17 Pro', ram_gb: 8, storage_gb: 128 },
        },
        {
          slug: 'galaxy-s24',
          name: 'Galaxy S24',
          brand: 'Samsung',
          price: 750_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Snapdragon 8 Gen 3',
            ram_gb: 12,
            storage_gb: 256,
          },
        },
      ],
      isCollection: false,
    };

    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: dualBrandPost,
      categoryDataOverride: multiBrandCategoryData,
    });

    const links = model?.commerceLinks.map((link) => link.href) ?? [];
    // Legitimate comparison between Apple and Samsung
    expect(links).toContain(
      'https://ogabassey.com/smartphones/compare/galaxy-s24-vs-iphone-15-pro'
    );
  });
});
