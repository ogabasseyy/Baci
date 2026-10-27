import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBrandAuthorityInventorySafely } from '@/lib/storefront-category/load-brand-authority-inventory-safely';
import { buildClusterHubLinks } from './build-cluster-hub-links';

vi.mock(
  '@/lib/storefront-category/load-brand-authority-inventory-safely',
  () => ({ loadBrandAuthorityInventorySafely: vi.fn() })
);

vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    getCategory: vi
      .fn()
      .mockResolvedValue({ id: 'cat-1', name: 'Smartphones' }),
  },
}));

const mockLoad = vi.mocked(loadBrandAuthorityInventorySafely);

const post = {
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

const products = [
  'iPhone 15 Pro Max',
  'iPhone 15 Pro',
  'iPhone 15',
  'iPhone 14',
  'iPhone 13',
].map((name) => ({
  name,
  brand: 'Apple',
  stock: 5,
  category_slug: 'smartphones',
}));

describe('buildClusterHubLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('emits brand and family links without verification when skipped', async () => {
    const result = await buildClusterHubLinks({
      post,
      inferredBrands: ['Apple'],
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      storeUrl: 'https://store.test',
      merchantId: 'merchant-1',
      products,
      skipDestinationVerification: true,
    });
    expect(result.brandHubLinks).toEqual([
      {
        href: 'https://store.test/smartphones/brands/apple',
        label: 'Explore Apple iPhone smartphones',
      },
    ]);
    expect(result.familyHubLinks).toEqual([
      {
        href: 'https://store.test/smartphones/brands/apple/families/iphone-15',
        label: 'Explore iPhone 15 Series',
      },
    ]);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('only verifies matched brands on the live path', async () => {
    mockLoad.mockResolvedValue({
      latestUpdatedAt: null,
      productCount: 5,
      productCountIsLowerBound: false,
      products: products.map((p, index) => ({
        ...p,
        id: `phone-${index}`,
        price: 100000,
      })),
    });
    const result = await buildClusterHubLinks({
      post,
      inferredBrands: ['Apple'],
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      storeUrl: 'https://store.test',
      merchantId: 'merchant-1',
      products: [
        ...products,
        ...[
          'Galaxy S24',
          'Galaxy S23',
          'Galaxy A55',
          'Galaxy A35',
          'Galaxy Z Flip',
        ].map((name) => ({
          name,
          brand: 'Samsung',
          stock: 5,
          category_slug: 'smartphones',
        })),
      ],
    });
    expect(result.brandHubLinks).toHaveLength(1);
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates aliased inferred brands resolving to the same hub', async () => {
    const xiaomiProducts = [
      'Redmi Note 13',
      'Redmi Note 12',
      'Xiaomi 14',
      'Xiaomi 13',
      'Redmi 12',
    ].map((name) => ({
      name,
      brand: 'Xiaomi',
      stock: 5,
      category_slug: 'smartphones',
    }));
    const result = await buildClusterHubLinks({
      post,
      inferredBrands: ['redmi', 'xiaomi'],
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      storeUrl: 'https://store.test',
      merchantId: 'merchant-1',
      products: xiaomiProducts,
      skipDestinationVerification: true,
    });
    expect(result.brandHubLinks).toHaveLength(1);
    expect(result.brandHubLinks[0]?.href).toBe(
      'https://store.test/smartphones/brands/xiaomi'
    );
  });

  it('emits no hub links when a skipped-verification pool is child-category only', async () => {
    const result = await buildClusterHubLinks({
      post,
      inferredBrands: ['Apple'],
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      storeUrl: 'https://store.test',
      merchantId: 'merchant-1',
      products: products.map((product) => ({
        ...product,
        category_slug: 'phone-accessories',
      })),
      skipDestinationVerification: true,
    });
    expect(result).toEqual({ brandHubLinks: [], familyHubLinks: [] });
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('matches bare Samsung model tokens against the combined post context', async () => {
    const result = await buildClusterHubLinks({
      post: {
        ...post,
        slug: 'a55-vs-a35-best-budget-phones',
        title: 'A55 vs A35: Best Budget Phones in Nigeria',
        excerpt: 'Two mid-rangers compared for Nigerian buyers.',
        tags: ['samsung'],
        keywords: ['budget phones'],
      },
      inferredBrands: ['Samsung'],
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      storeUrl: 'https://store.test',
      merchantId: 'merchant-1',
      products: [
        'Galaxy A55',
        'Galaxy A35',
        'Galaxy A25',
        'Galaxy A15',
        'Galaxy A05',
      ].map((name) => ({
        name,
        brand: 'Samsung',
        stock: 5,
        category_slug: 'smartphones',
      })),
      skipDestinationVerification: true,
    });
    expect(result.brandHubLinks).toHaveLength(1);
    expect(result.familyHubLinks).toEqual([
      {
        href: 'https://store.test/smartphones/brands/samsung/families/galaxy-a',
        label: 'Explore Samsung Galaxy A',
      },
    ]);
  });

  it('does not attribute bare Samsung tokens when only a rival brand is tagged', async () => {
    const result = await buildClusterHubLinks({
      post: {
        ...post,
        slug: 'a55-vs-a35-best-budget-phones',
        title: 'A55 vs A35: Best Budget Phones in Nigeria',
        excerpt: 'Two mid-rangers compared for Nigerian buyers.',
        tags: ['tecno'],
        keywords: ['budget phones'],
      },
      inferredBrands: ['Samsung'],
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      storeUrl: 'https://store.test',
      merchantId: 'merchant-1',
      products: [
        'Galaxy A55',
        'Galaxy A35',
        'Galaxy A25',
        'Galaxy A15',
        'Galaxy A05',
      ].map((name) => ({
        name,
        brand: 'Samsung',
        stock: 5,
        category_slug: 'smartphones',
      })),
      skipDestinationVerification: true,
    });
    expect(result.brandHubLinks).toHaveLength(1);
    expect(result.familyHubLinks).toEqual([]);
  });

  it('does not attribute a rival-owned title token even when Samsung is tagged', async () => {
    const result = await buildClusterHubLinks({
      post: {
        ...post,
        slug: 'oppo-a55-vs-a35-budget-shootout',
        title: 'Oppo A55 vs A35: Budget Shootout',
        excerpt: 'Two mid-rangers compared for Nigerian buyers.',
        tags: ['samsung'],
        keywords: ['budget phones'],
      },
      inferredBrands: ['Samsung'],
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      storeUrl: 'https://store.test',
      merchantId: 'merchant-1',
      products: [
        'Galaxy A55',
        'Galaxy A35',
        'Galaxy A25',
        'Galaxy A15',
        'Galaxy A05',
      ].map((name) => ({
        name,
        brand: 'Samsung',
        stock: 5,
        category_slug: 'smartphones',
      })),
      skipDestinationVerification: true,
    });
    expect(result.familyHubLinks).toEqual([]);
  });

  it('returns no links when no brand is inferred', async () => {
    const result = await buildClusterHubLinks({
      post,
      inferredBrands: [],
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      storeUrl: 'https://store.test',
      merchantId: 'merchant-1',
      products,
      skipDestinationVerification: true,
    });
    expect(result).toEqual({ brandHubLinks: [], familyHubLinks: [] });
  });
  it('uses destination inventory even when the semantic preview pool is empty', async () => {
    mockLoad.mockResolvedValue({
      latestUpdatedAt: null,
      productCount: 5,
      productCountIsLowerBound: false,
      products: products.map((product, index) => ({
        ...product,
        id: `product-${index}`,
        price: 100000,
        slug: `phone-${index}`,
      })),
    });
    const result = await buildClusterHubLinks({
      post,
      inferredBrands: ['Apple'],
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      storeUrl: 'https://store.test',
      merchantId: 'merchant-1',
      products: [],
    });
    expect(result.brandHubLinks).toHaveLength(1);
    expect(result.familyHubLinks).toHaveLength(1);
  });
});
