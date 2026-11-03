import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelFamilyAuthorityPageLoader } from './load-model-family-authority-page';

const mockLoadBrandPage = vi.fn();
const mockLoadClusterPosts = vi.fn();
type LoadBrandAuthorityPageModule =
  typeof import('@/lib/storefront-category/load-brand-authority-page');
vi.mock(
  '@/lib/storefront-category/load-brand-authority-page',
  async (importOriginal) => {
    const actual = await importOriginal<LoadBrandAuthorityPageModule>();
    return {
      ...actual,
      brandAuthorityPageLoader: {
        load: (...args: unknown[]) => mockLoadBrandPage(...args),
      },
    };
  }
);
vi.mock('@/lib/storefront-content/load-published-cluster-posts-safely', () => ({
  loadPublishedClusterPostsSafely: (...args: unknown[]) =>
    mockLoadClusterPosts(...args),
}));

const guidePost = {
  slug: 'samsung-galaxy-s24-buying-guide',
  title: 'Samsung Galaxy S24 Buying Guide',
  excerpt: 'Should you buy the Galaxy S24 in Nigeria?',
  category: 'Smartphones',
  tags: ['samsung', 'galaxy s24'],
  keywords: ['galaxy s24'],
  featured_image_url: null,
  published_at: '2026-04-10T09:00:00.000Z',
  reading_time_minutes: 5,
};

describe('model family authority page news exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadClusterPosts.mockResolvedValue([]);
    mockLoadBrandPage.mockResolvedValue({
      canonicalUrl: 'https://store.test/smartphones/brands/samsung',
      merchant: {
        id: 'merchant-id',
        business_name: 'Store',
        country: 'NG',
        slug: 'store',
        custom_domain: null,
      },
      brand: { brandKey: 'samsung', displayName: 'Samsung' },
      products: [
        { name: 'Samsung Galaxy S24', slug: 'samsung-galaxy-s24' },
        { name: 'Samsung Galaxy S25', slug: 'samsung-galaxy-s25' },
        { name: 'Samsung Galaxy S26', slug: 'samsung-galaxy-s26' },
      ],
      breadcrumbItems: [
        { name: 'Store', url: 'https://store.test' },
        { name: 'Smartphones', url: 'https://store.test/smartphones' },
        {
          name: 'Samsung',
          url: 'https://store.test/smartphones/brands/samsung',
        },
      ],
    });
  });

  it('excludes news-classified posts from family guide links', async () => {
    mockLoadClusterPosts.mockResolvedValue([guidePost]);
    const guidePage = await modelFamilyAuthorityPageLoader.load({
      merchantSlug: 'store',
      categorySlug: 'smartphones',
      brandSlug: 'samsung',
      familySlug: 'galaxy-s',
    });
    expect(guidePage?.guideLinks.length).toBeGreaterThan(0);

    mockLoadClusterPosts.mockResolvedValue([
      {
        ...guidePost,
        merchant_intent: 'news',
        merchant_intent_source: 'merchant_declared',
      },
    ]);
    const newsPage = await modelFamilyAuthorityPageLoader.load({
      merchantSlug: 'store',
      categorySlug: 'smartphones',
      brandSlug: 'samsung',
      familySlug: 'galaxy-s',
    });
    expect(newsPage?.guideLinks).toEqual([]);
  });
});
