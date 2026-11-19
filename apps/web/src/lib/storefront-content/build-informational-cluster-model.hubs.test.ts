import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInformationalClusterModel } from './build-informational-cluster-model';

vi.mock(
  '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely',
  () => ({ loadCategoryScopedSemanticInventorySafely: vi.fn() })
);

describe('buildInformationalClusterModel hub links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      destinationVerified: true,
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

  it('links the family hub when the family is mentioned only in the excerpt', async () => {
    const post = {
      slug: 'apple-buying-guide-nigeria',
      title: 'Apple Buying Guide for Nigeria',
      excerpt: 'Our iPhone 15 picks for every budget.',
      category: 'Smartphones',
      tags: ['apple'],
      keywords: ['apple phones'],
      featured_image_url: null,
      published_at: '2026-04-10T09:00:00.000Z',
      reading_time_minutes: 5,
    };
    const products = [
      'iPhone 15 Pro Max',
      'iPhone 15 Pro',
      'iPhone 15',
      'iPhone 14',
      'iPhone 13',
    ].map((name, index) => ({
      slug: name.toLowerCase().replaceAll(' ', '-'),
      name,
      brand: 'Apple',
      price: 500_000 - index * 10_000,
      category_slug: 'smartphones',
      stock: 3,
    }));
    const model = await buildInformationalClusterModel({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      storeUrl: 'https://ogabassey.com',
      post,
      categoryDataOverride: {
        category: { slug: 'smartphones', name: 'Smartphones' },
        products,
        isCollection: false,
        destinationVerified: true,
      },
    });
    const links = model?.commerceLinks.map((link) => link.href) ?? [];
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
      destinationVerified: true,
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
      destinationVerified: true,
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
});
