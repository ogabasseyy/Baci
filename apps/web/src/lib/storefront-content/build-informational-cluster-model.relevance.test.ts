import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInformationalClusterModel } from './build-informational-cluster-model';
import {
  smartphoneCategoryData,
  smartphoneGuidePost,
} from './build-informational-cluster-model.test-fixtures';

vi.mock(
  '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely',
  () => ({ loadCategoryScopedSemanticInventorySafely: vi.fn() })
);

describe('buildInformationalClusterModel relevance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('does NOT link Galaxy AI article to Galaxy A family hub', async () => {
    const galaxyAiPost = {
      slug: 'samsung-galaxy-ai-features-guide',
      title: 'Galaxy AI Features: What You Need to Know in 2026',
      excerpt: 'Everything new with Galaxy AI on Samsung flagships.',
      category: 'Smartphones',
      tags: ['samsung', 'galaxy-ai'],
      keywords: ['samsung', 'galaxy', 'ai'],
      featured_image_url: null,
      published_at: '2026-04-10T09:00:00.000Z',
      reading_time_minutes: 5,
    };

    const samsungCategoryData = {
      category: { slug: 'smartphones', name: 'Smartphones' },
      products: [
        {
          slug: 'galaxy-a55',
          name: 'Galaxy A55 5G',
          brand: 'Samsung',
          price: 350_000,
          category_slug: 'smartphones',
        },
        {
          slug: 'galaxy-a35',
          name: 'Galaxy A35 5G',
          brand: 'Samsung',
          price: 300_000,
          category_slug: 'smartphones',
        },
        {
          slug: 'galaxy-a15',
          name: 'Galaxy A15',
          brand: 'Samsung',
          price: 200_000,
          category_slug: 'smartphones',
        },
        {
          slug: 'galaxy-s24',
          name: 'Galaxy S24',
          brand: 'Samsung',
          price: 750_000,
          category_slug: 'smartphones',
        },
        {
          slug: 'galaxy-s24-plus',
          name: 'Galaxy S24 Plus',
          brand: 'Samsung',
          price: 900_000,
          category_slug: 'smartphones',
        },
      ],
      isCollection: false,
    };

    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: galaxyAiPost,
      categoryDataOverride: samsungCategoryData,
    });

    const links = model?.commerceLinks.map((link) => link.href) ?? [];
    // Brand hub is eligible and linked
    expect(links).toContain('https://ogabassey.com/smartphones/brands/samsung');

    // Must NOT link to Galaxy A family hub because article is about Galaxy AI!
    expect(links).not.toContain(
      'https://ogabassey.com/smartphones/brands/samsung/families/galaxy-a'
    );
  });

  it('rejects unrelated Oppo text from matching Oppo A-Series while linking real Oppo A78 article', async () => {
    const oppoInventory = {
      category: { slug: 'smartphones', name: 'Smartphones' },
      products: [
        {
          slug: 'oppo-a78',
          name: 'Oppo A78 4G',
          brand: 'Oppo',
          price: 240_000,
          category_slug: 'smartphones',
        },
        {
          slug: 'oppo-a58',
          name: 'Oppo A58',
          brand: 'Oppo',
          price: 190_000,
          category_slug: 'smartphones',
        },
        {
          slug: 'oppo-a38',
          name: 'Oppo A38',
          brand: 'Oppo',
          price: 160_000,
          category_slug: 'smartphones',
        },
        {
          slug: 'oppo-reno-12',
          name: 'Oppo Reno 12 5G',
          brand: 'Oppo',
          price: 500_000,
          category_slug: 'smartphones',
        },
        {
          slug: 'oppo-find-x7',
          name: 'Oppo Find X7 Ultra',
          brand: 'Oppo',
          price: 900_000,
          category_slug: 'smartphones',
        },
      ],
      isCollection: false,
    };

    // 1. Unrelated Oppo Reno camera article
    const renoPost = {
      slug: 'oppo-reno-12-camera-portrait-review',
      title: 'Oppo Reno 12 Camera: AI Portrait and Low Light Shootout',
      excerpt: 'Testing the AI portrait capabilities of the Oppo Reno series.',
      category: 'Smartphones',
      tags: ['oppo', 'reno', 'camera'],
      keywords: ['oppo', 'camera'],
      featured_image_url: null,
      published_at: '2026-04-10T09:00:00.000Z',
      reading_time_minutes: 5,
    };

    const renoModel = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: renoPost,
      categoryDataOverride: oppoInventory,
    });

    const renoLinks = renoModel?.commerceLinks.map((link) => link.href) ?? [];
    expect(renoLinks).not.toContain(
      'https://ogabassey.com/smartphones/brands/oppo/families/a-series'
    );

    // 2. Real Oppo A78 article
    const a78Post = {
      slug: 'oppo-a78-4g-full-review-nigeria',
      title: 'Oppo A78 4G Full Review: Premium Design on a Budget',
      excerpt: 'Comprehensive hands-on review of the Oppo A78.',
      category: 'Smartphones',
      tags: ['oppo', 'a78', 'review'],
      keywords: ['oppo', 'a78'],
      featured_image_url: null,
      published_at: '2026-04-10T09:00:00.000Z',
      reading_time_minutes: 5,
    };

    const a78Model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post: a78Post,
      categoryDataOverride: oppoInventory,
    });

    const a78Links = a78Model?.commerceLinks.map((link) => link.href) ?? [];
    expect(a78Links).toContain(
      'https://ogabassey.com/smartphones/brands/oppo/families/a-series'
    );
  });
});
