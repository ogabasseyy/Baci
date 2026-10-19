import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();
const mockPurgeCloudflareUrls = vi.fn();
const mockAfter = vi.fn((callback: () => unknown) => {
  callback();
});

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => mockAfter(callback),
}));
vi.mock('@/lib/cloudflare-purge', () => ({
  purgeCloudflareUrls: (...args: unknown[]) => mockPurgeCloudflareUrls(...args),
}));

import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { getBlogContentLinksCacheTag } from '@/lib/blog-content-link-cache-tags';
import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import { getProductScopedCacheTag } from '@/lib/product-cache-tags';
// ---- Import functions AFTER mocks ----
import {
  revalidateBlogPosts,
  revalidateCategories,
  revalidateDomains,
  revalidateFeatures,
  revalidateMerchant,
  revalidateMerchantFeed,
  revalidateMerchantPublication,
  revalidatePageConfig,
  revalidatePlatformBlog,
  revalidateProductSlugs,
  revalidateProducts,
  revalidateRepairsCatalog,
  revalidateReviews,
} from './cache-revalidation';

// ---- Helpers ----

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

// ---- Tests ----

describe('cache-revalidation utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('revalidateProducts', () => {
    it('revalidates products cache with merchant ID', () => {
      revalidateProducts(MERCHANT_ID);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `storefront-products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-details',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getCategoryPageDataCacheTag(MERCHANT_ID),
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `product-index-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `product-slug-set-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-canonical-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-legacy-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'google-merchant-feed',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-feed-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(14);
    });

    it('revalidates specific product when slug provided', () => {
      const productSlug = 'test-product';

      revalidateProducts(MERCHANT_ID, productSlug);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `storefront-products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `product-${MERCHANT_ID}-${productSlug}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-details',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getCategoryPageDataCacheTag(MERCHANT_ID),
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `product-index-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `product-slug-set-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-legacy-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-canonical-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'google-merchant-feed',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-feed-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(15);
    });

    it('revalidates non-ASCII product slugs with ByteString-safe cache tags', () => {
      const productSlug = 'dell-alienware-x14-r2-–-14”';

      revalidateProducts(MERCHANT_ID, productSlug);

      const expectedTag = getProductScopedCacheTag(
        'product',
        MERCHANT_ID,
        productSlug
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(expectedTag, 'products');
      expect(expectedTag).not.toContain('–');
      expect(expectedTag).not.toContain('”');
      expect(mockRevalidateTag).toHaveBeenCalledTimes(15);
    });

    it('handles empty slug gracefully', () => {
      revalidateProducts(MERCHANT_ID, '');

      // Should not call specific product tag when slug is empty
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `storefront-products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(14);
    });
  });

  describe('revalidateProductSlugs', () => {
    it('invalidates the per-slug scoped product tag for each slug', () => {
      revalidateProductSlugs(MERCHANT_ID, ['iphone-15', 'galaxy-s25']);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getProductScopedCacheTag('product', MERCHANT_ID, 'iphone-15'),
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getProductScopedCacheTag('product', MERCHANT_ID, 'galaxy-s25'),
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('deduplicates and skips blank/nullish slugs', () => {
      revalidateProductSlugs(MERCHANT_ID, [
        'iphone-15',
        '  iphone-15  ',
        '   ',
        null,
        undefined,
      ]);

      expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getProductScopedCacheTag('product', MERCHANT_ID, 'iphone-15'),
        'products'
      );
    });

    it('is a no-op for a blank merchant id', () => {
      revalidateProductSlugs('   ', ['iphone-15']);

      expect(mockRevalidateTag).not.toHaveBeenCalled();
    });
  });

  describe('revalidateCategories', () => {
    it('revalidates categories cache with merchant ID', () => {
      revalidateCategories(MERCHANT_ID);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `categories-${MERCHANT_ID}`,
        'categories'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'navigation-categories',
        'categories'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getCategoryPageDataCacheTag(MERCHANT_ID),
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-canonical-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-legacy-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(5);
    });

    it('revalidates specific category when slug provided', () => {
      const categorySlug = 'test-category';

      revalidateCategories(MERCHANT_ID, categorySlug);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `categories-${MERCHANT_ID}`,
        'categories'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'navigation-categories',
        'categories'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `category-${MERCHANT_ID}-${categorySlug}`,
        'categories'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getCategoryPageDataCacheTag(MERCHANT_ID),
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-canonical-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-legacy-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(6);
    });

    it('handles empty slug gracefully', () => {
      revalidateCategories(MERCHANT_ID, '');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `categories-${MERCHANT_ID}`,
        'categories'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-canonical-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-legacy-redirect',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(5);
    });
  });

  describe('revalidateMerchant', () => {
    it('revalidates merchant cache with merchant ID', () => {
      revalidateMerchant(MERCHANT_ID);

      expect(mockRevalidateTag).toHaveBeenCalledWith('merchants', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(3);
    });

    it('revalidates specific merchant when slug provided', () => {
      const merchantSlug = 'test-store';

      revalidateMerchant(MERCHANT_ID, merchantSlug);

      expect(mockRevalidateTag).toHaveBeenCalledWith('merchants', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-${merchantSlug}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(4);
    });

    it('handles empty slug gracefully', () => {
      revalidateMerchant(MERCHANT_ID, '');

      expect(mockRevalidateTag).toHaveBeenCalledWith('merchants', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(3);
    });
  });

  describe('revalidateMerchantPublication', () => {
    it('hard-expires only the merchant-scoped publication caches and aliases', () => {
      revalidateMerchantPublication({
        merchantId: MERCHANT_ID,
        canonicalMerchantSlug: 'ogabassey',
        identifiers: ['ogabassey', 'old-store', 'OGABASSEY.COM'],
      });

      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'merchants',
        expect.anything()
      );
      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'domains',
        expect.anything()
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        { expire: 0 }
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith('merchant-ogabassey', {
        expire: 0,
      });
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-slug-ogabassey',
        { expire: 0 }
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-slug-old-store',
        { expire: 0 }
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith('domain-ogabassey.com', {
        expire: 0,
      });
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'domain-www.ogabassey.com',
        { expire: 0 }
      );
      expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
    });

    it('throws when an invalid merchant ID prevents publication revalidation', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        // Expected in this runtime-guard test.
      });

      expect(() =>
        revalidateMerchantPublication({
          merchantId: ' ',
          canonicalMerchantSlug: 'ogabassey',
          identifiers: ['ogabassey'],
        })
      ).toThrow('Invalid merchant ID for publication cache revalidation');

      expect(mockRevalidateTag).not.toHaveBeenCalled();
      expect(mockPurgeCloudflareUrls).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it('hard-expires domain state without a canonical slug', () => {
      expect(() =>
        revalidateMerchantPublication({
          merchantId: MERCHANT_ID,
          canonicalMerchantSlug: null,
          identifiers: [null, 'ogabassey.com'],
        })
      ).not.toThrow();

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        { expire: 0 }
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith('domain-ogabassey.com', {
        expire: 0,
      });
      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        expect.stringMatching(/^merchant-slug-/),
        expect.anything()
      );
    });
  });

  describe('revalidateBlogPosts', () => {
    it('invalidates only the merchant content-link tag when merchantId is present', () => {
      revalidateBlogPosts({
        merchantId: MERCHANT_ID,
        identifiers: ['test-merchant'],
        postSlugs: ['test-post'],
      });

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogContentLinksCacheTag(MERCHANT_ID),
        'merchant'
      );
      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'blog-content-links',
        'merchant'
      );
      expect(
        mockRevalidateTag.mock.calls.filter(([tag]) =>
          String(tag).startsWith('blog-content-links')
        )
      ).toEqual([[getBlogContentLinksCacheTag(MERCHANT_ID), 'merchant']]);
    });

    it('keeps the broad content-link tag for legacy callers without merchantId', () => {
      revalidateBlogPosts('test-merchant', 'test-post');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-content-links',
        'merchant'
      );
      expect(
        mockRevalidateTag.mock.calls.filter(([tag]) =>
          String(tag).startsWith('blog-content-links')
        )
      ).toEqual([['blog-content-links', 'merchant']]);
    });

    it('revalidates blog posts cache', () => {
      revalidateBlogPosts({
        identifiers: ['test-merchant', 'OGABASSEY.COM', 'test-merchant'],
        canonicalMerchantSlug: 'test-merchant',
        listingCategories: ['Reviews'],
        listingPages: [1, 2, 2],
        postSlugs: ['test-post', 'Test-Post'],
      });

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-merchant-all-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-merchant-all-2',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-merchant-Reviews-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogCacheTag('test-merchant', 'test-post'),
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-ogabassey.com-all-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogCacheTag('OGABASSEY.COM', 'test-post'),
        'merchant'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/test-merchant/blog');
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/test-merchant/blog/test-post'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/test-merchant/blog/test-post/opengraph-image'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/ogabassey.com/blog');
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/ogabassey.com/blog/test-post'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/ogabassey.com/blog/test-post/opengraph-image'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/api/blog/feed/test-merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-rss-feed',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith('blog-posts', 'merchant');
    });

    it('supports the legacy identifier + slug signature', () => {
      revalidateBlogPosts('test-merchant', 'test-post');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-merchant-all-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogCacheTag('test-merchant', 'test-post'),
        'merchant'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/test-merchant/blog');
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/test-merchant/blog/test-post'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/test-merchant/blog/test-post/opengraph-image'
      );
      expect(mockRevalidatePath).not.toHaveBeenCalledWith(
        '/api/blog/feed/test-merchant'
      );
    });

    it('handles empty identifiers and slugs gracefully', () => {
      revalidateBlogPosts({
        identifiers: [' ', null, undefined],
        postSlugs: ['', null, undefined],
      });

      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(mockRevalidateTag).not.toHaveBeenCalled();
    });

    it('uses explicit canonicalMerchantSlug for feed invalidation instead of identifier order', () => {
      revalidateBlogPosts({
        identifiers: ['shop.example.com', 'ogabassey'],
        canonicalMerchantSlug: 'ogabassey',
      });

      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/api/blog/feed/ogabassey'
      );
      expect(mockRevalidatePath).not.toHaveBeenCalledWith(
        '/api/blog/feed/shop.example.com'
      );
    });

    it('skips unsafe canonicalMerchantSlug values for feed path revalidation', () => {
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      revalidateBlogPosts({
        identifiers: ['test-merchant'],
        canonicalMerchantSlug: '../evil/path',
      });

      expect(mockRevalidatePath).not.toHaveBeenCalledWith(
        '/api/blog/feed/../evil/path'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipped blog feed path revalidation for invalid slug',
        {
          canonicalMerchantSlug: '../evil/path',
        }
      );

      warnSpy.mockRestore();
    });

    it('works with a merchant identifier as a single path target', () => {
      revalidateBlogPosts(MERCHANT_ID, 'my-blog-post');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `blog-list-${MERCHANT_ID}-all-1`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogCacheTag(MERCHANT_ID, 'my-blog-post'),
        'merchant'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/${MERCHANT_ID}/blog`);
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        `/${MERCHANT_ID}/blog/my-blog-post`
      );
    });
  });

  describe('revalidateReviews', () => {
    it('revalidates reviews cache with product ID', () => {
      const productId = 'product-123';

      revalidateReviews(productId);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `reviews-${productId}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `rating-stats-${productId}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('works with different product IDs', () => {
      const productId1 = 'product-456';
      const productId2 = 'product-789';

      revalidateReviews(productId1);
      mockRevalidateTag.mockClear();
      revalidateReviews(productId2);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `reviews-${productId2}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `rating-stats-${productId2}`,
        'products'
      );
    });
  });

  describe('revalidateFeatures', () => {
    it('revalidates features cache with merchant ID', () => {
      revalidateFeatures(MERCHANT_ID);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `features-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    });

    it('works with different merchant IDs', () => {
      const merchantId1 = 'merchant-111';
      const merchantId2 = 'merchant-222';

      revalidateFeatures(merchantId1);
      mockRevalidateTag.mockClear();
      revalidateFeatures(merchantId2);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `features-${merchantId2}`,
        'merchant'
      );
    });
  });

  describe('revalidatePageConfig', () => {
    it('revalidates page config cache', () => {
      revalidatePageConfig(MERCHANT_ID);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'page-config',
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    });

    it('revalidates specific page when slug provided', () => {
      const pageSlug = 'about-us';

      revalidatePageConfig(MERCHANT_ID, pageSlug);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'page-config',
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `page-config-${MERCHANT_ID}-${pageSlug}`,
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('handles empty slug gracefully', () => {
      revalidatePageConfig(MERCHANT_ID, '');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'page-config',
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    });

    it('works with different merchant IDs and page slugs', () => {
      const merchantId = 'merchant-333';
      const pageSlug = 'contact';

      revalidatePageConfig(merchantId, pageSlug);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `page-config-${merchantId}-${pageSlug}`,
        'storefront-page'
      );
    });
  });

  describe('revalidateMerchantFeed', () => {
    it('revalidates global, merchant, and review-signal feed tags', () => {
      revalidateMerchantFeed('ogabassey');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'google-merchant-feed',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'openai-product-feed',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-feed-ogabassey',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-feed-review-signals-ogabassey',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(4);
    });

    it('works with merchant UUID as identifier', () => {
      revalidateMerchantFeed(MERCHANT_ID);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'google-merchant-feed',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'openai-product-feed',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-feed-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-feed-review-signals-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(4);
    });
  });

  describe('revalidateRepairsCatalog', () => {
    it('revalidates the global and merchant-scoped repairs feed tags', () => {
      revalidateRepairsCatalog(MERCHANT_ID);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'repairs-catalog-feed',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `repairs-feed-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('skips revalidation for a blank merchant id', () => {
      revalidateRepairsCatalog('   ');

      expect(mockRevalidateTag).not.toHaveBeenCalled();
    });
  });

  describe('revalidateDomains', () => {
    it('revalidates domains cache without domain', () => {
      revalidateDomains();

      expect(mockRevalidateTag).toHaveBeenCalledWith('domains', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    });

    it('revalidates specific domain when provided', () => {
      const domain = 'example.com';

      revalidateDomains(domain);

      expect(mockRevalidateTag).toHaveBeenCalledWith('domains', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'domain-example.com',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('converts domain to lowercase', () => {
      const domain = 'Example.COM';

      revalidateDomains(domain);

      expect(mockRevalidateTag).toHaveBeenCalledWith('domains', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'domain-example.com',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('handles empty domain gracefully', () => {
      revalidateDomains('');

      expect(mockRevalidateTag).toHaveBeenCalledWith('domains', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    });

    it('works with subdomain', () => {
      const domain = 'shop.example.com';

      revalidateDomains(domain);

      expect(mockRevalidateTag).toHaveBeenCalledWith('domains', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'domain-shop.example.com',
        'merchant'
      );
    });
  });

  describe('revalidatePlatformBlog', () => {
    it('revalidates platform blog tags and shared paths', () => {
      revalidatePlatformBlog();

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'platform-blog',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'platform-blog-list',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'platform-blog-sitemap',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'platform-blog-feed',
        'merchant'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/blog');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/blog/feed.xml');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/sitemap.xml');
    });

    it('revalidates slug-scoped paths and tag when a slug is provided', () => {
      revalidatePlatformBlog('platform-launch');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'platform-blog-post-platform-launch',
        'merchant'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/blog/platform-launch');
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/blog/platform-launch/opengraph-image'
      );
    });
  });

  describe('edge cases', () => {
    it('handles special characters in slugs', () => {
      revalidateProducts(MERCHANT_ID, 'test-product-123');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `product-${MERCHANT_ID}-test-product-123`,
        'products'
      );
    });

    it('handles UUID merchant IDs', () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000';

      revalidateProducts(uuid);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `products-${uuid}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${uuid}`,
        'merchant'
      );
    });

    it('does not throw when called multiple times rapidly', () => {
      expect(() => {
        for (let i = 0; i < 100; i++) {
          revalidateProducts(MERCHANT_ID);
        }
      }).not.toThrow();

      expect(mockRevalidateTag).toHaveBeenCalledTimes(1400); // 14 calls per invocation * 100
    });

    it('handles null/undefined merchant IDs gracefully', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        // Expected in this runtime-guard test.
      });

      // TypeScript should prevent this, but test runtime behavior
      revalidateProducts(undefined as unknown as string);

      expect(mockRevalidateTag).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[WARN\] Skipped product cache revalidation for invalid merchant ID$/
        ),
        {
          merchantId: '',
          message: 'Skipped product cache revalidation for invalid merchant ID',
        }
      );
      warnSpy.mockRestore();
    });
  });

  describe('integration scenarios', () => {
    it('multiple revalidations work together', () => {
      // Simulate a product update that affects multiple caches
      revalidateProducts(MERCHANT_ID, 'new-product');
      revalidateCategories(MERCHANT_ID, 'electronics');
      revalidateMerchant(MERCHANT_ID);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `categories-${MERCHANT_ID}`,
        'categories'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith('merchants', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
    });

    it('works when called sequentially in a workflow', () => {
      // Simulate a store publish workflow
      revalidateMerchant(MERCHANT_ID, 'my-store');
      revalidateProducts(MERCHANT_ID);
      revalidateFeatures(MERCHANT_ID);

      expect(mockRevalidateTag).toHaveBeenCalledWith('merchants', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `features-${MERCHANT_ID}`,
        'merchant'
      );
    });
  });
});
