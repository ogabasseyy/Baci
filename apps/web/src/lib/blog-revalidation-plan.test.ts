import { describe, expect, it } from 'vitest';
import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { getBlogContentLinksCacheTag } from '@/lib/blog-content-link-cache-tags';
import { buildBlogRevalidationPlan } from './blog-revalidation-plan';

describe('buildBlogRevalidationPlan', () => {
  it('emits only tenant and identifier scoped tags when merchantId and identifiers are supplied', () => {
    const plan = buildBlogRevalidationPlan({
      merchantId: 'merchant-1',
      identifiers: ['Ogabassey', 'ogabassey.com'],
      canonicalMerchantSlug: 'ogabassey',
      listingCategories: ['Buying Guides'],
      listingPages: [1, 2],
      postSlugs: ['Best-Phone'],
    });

    expect(plan.tags).not.toContain('blog-posts');
    expect(plan.tags).not.toContain('blog-rss-feed');
    expect(plan.tags).not.toContain('blog-content-links');
    expect(plan.tags).toEqual(
      expect.arrayContaining([
        'blog-posts-merchant-1',
        'blog-categories-merchant-1',
        getBlogContentLinksCacheTag('merchant-1'),
        'blog-rss-merchant-1',
        'blog-rss-ogabassey',
        'blog-rss-ogabassey.com',
        'blog-identifier-ogabassey',
        'blog-identifier-ogabassey.com',
        'blog-listing-status-ogabassey',
        'blog-category-hub-ogabassey',
        'blog-list-ogabassey-all-1',
        'blog-list-ogabassey-Buying Guides-2',
        getBlogCacheTag('ogabassey', 'best-phone'),
        getBlogCacheTag('ogabassey.com', 'best-phone'),
      ])
    );
    expect(plan.paths).toContain('/api/blog/feed/ogabassey');
    expect(plan.purgeCategorySlugs).toEqual(['buying-guides']);
  });

  it('supports merchantId-only revalidation without global blog tags', () => {
    const plan = buildBlogRevalidationPlan({ merchantId: 'merchant-1' });

    expect(plan.tags).toEqual([
      'blog-posts-merchant-1',
      'blog-categories-merchant-1',
      getBlogContentLinksCacheTag('merchant-1'),
      'blog-rss-merchant-1',
    ]);
    expect(plan.paths).toEqual([]);
  });

  it('falls back to global blog tags only when neither merchantId nor identifiers are provided', () => {
    const plan = buildBlogRevalidationPlan({});

    expect(plan.tags).toEqual(['blog-rss-feed', 'blog-posts']);
  });

  it('returns an empty plan when explicit identifiers normalize to empty', () => {
    const plan = buildBlogRevalidationPlan({
      identifiers: [' ', null, undefined],
      postSlugs: ['', null],
    });

    expect(plan.tags).toEqual([]);
    expect(plan.paths).toEqual([]);
  });
});
