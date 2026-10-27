import { describe, expect, it } from 'vitest';
import {
  buildBlogCategoryHref,
  buildBlogCategorySchemaUrl,
  canUseCleanBlogCategorySlug,
  findBlogCategoryLabelBySlug,
  getBlogCategorySlug,
  getCanonicalBlogCategorySlug,
  getCollidingBlogCategorySlugs,
  getOgabasseyBlogCategoryAliasSlug,
  hasBlogCategorySlugCollision,
  isOgabasseyBlogStaticTenant,
  OGABASSEY_BLOG_PRIMARY_STATIC_TENANT,
  OGABASSEY_BLOG_STATIC_TENANTS,
} from './blog-category-routing';

describe('blog category routing', () => {
  it('shares the monitored OgaBassey blog tenants across listing and category routes', () => {
    expect(OGABASSEY_BLOG_PRIMARY_STATIC_TENANT).toBe('ogabassey.com');
    expect(OGABASSEY_BLOG_STATIC_TENANTS).toContain('ogabassey.com');
    expect(OGABASSEY_BLOG_STATIC_TENANTS).toContain('ogabassey');
  });

  it('generates clean lowercase category slugs', () => {
    expect(getBlogCategorySlug('Smartphones')).toBe('smartphones');
    expect(getBlogCategorySlug('Cases & Covers')).toBe('cases-covers');
  });

  it('builds storefront-relative category hub hrefs', () => {
    expect(buildBlogCategoryHref('/', 'Smartphones')).toBe(
      '/blog/category/smartphones'
    );
    expect(buildBlogCategoryHref('', 'Smartphones')).toBe(
      '/blog/category/smartphones'
    );
    expect(buildBlogCategoryHref('/ogabassey', 'Smartphones')).toBe(
      '/ogabassey/blog/category/smartphones'
    );
    expect(buildBlogCategoryHref('/ogabassey/', 'Smartphones')).toBe(
      '/ogabassey/blog/category/smartphones'
    );
  });

  it('falls back to query-string category hrefs when slug generation is empty', () => {
    expect(buildBlogCategoryHref('/ogabassey', '🔥🔥')).toBe(
      '/ogabassey/blog?category=%F0%9F%94%A5%F0%9F%94%A5'
    );
    expect(buildBlogCategoryHref('', '!!!')).toBe('/blog?category=%21%21%21');
  });

  it('falls back to query-string category hrefs for proxy-blocked clean slugs', () => {
    expect(buildBlogCategoryHref('/ogabassey', 'Product')).toBe(
      '/ogabassey/blog?category=Product'
    );
    expect(buildBlogCategorySchemaUrl('https://ogabassey.com', 'Product')).toBe(
      'https://ogabassey.com/blog?category=Product'
    );
    expect(canUseCleanBlogCategorySlug('product')).toBe(false);
  });

  it('keeps colliding category slugs on query-string hrefs', () => {
    expect(
      buildBlogCategoryHref('/ogabassey', 'Cases Covers', [
        'Cases & Covers',
        'Cases Covers',
      ])
    ).toBe('/ogabassey/blog?category=Cases+Covers');
  });

  it('builds absolute schema URLs without leaking query filters', () => {
    expect(
      buildBlogCategorySchemaUrl('https://ogabassey.com', 'Smartphones')
    ).toBe('https://ogabassey.com/blog/category/smartphones');
    expect(
      buildBlogCategorySchemaUrl('https://ogabassey.com/', 'Smartphones')
    ).toBe('https://ogabassey.com/blog/category/smartphones');
    expect(buildBlogCategorySchemaUrl('https://ogabassey.com', '🔥🔥')).toBe(
      'https://ogabassey.com/blog?category=%F0%9F%94%A5%F0%9F%94%A5'
    );
  });

  it('throws when category schema URLs receive an invalid base URL', () => {
    expect(() =>
      buildBlogCategorySchemaUrl('not-a-valid-url', 'Smartphones')
    ).toThrow();
  });

  it('matches category labels by slug', () => {
    expect(
      findBlogCategoryLabelBySlug(
        ['Smartphones', 'Cases & Covers'],
        'cases-covers'
      )
    ).toBe('Cases & Covers');
  });

  it('keeps review and news category slugs exact and exposes the Ogabassey cleanup aliases separately', () => {
    expect(getCanonicalBlogCategorySlug('review')).toBe('review');
    expect(getOgabasseyBlogCategoryAliasSlug('review')).toBe('reviews');
    expect(getCanonicalBlogCategorySlug('news')).toBe('news');
    expect(getOgabasseyBlogCategoryAliasSlug('news')).toBe('tech-news');
    expect(getOgabasseyBlogCategoryAliasSlug('smartphones')).toBeNull();
    expect(isOgabasseyBlogStaticTenant('ogabassey.com')).toBe(true);
    expect(isOgabasseyBlogStaticTenant('ogabassey')).toBe(true);
    expect(isOgabasseyBlogStaticTenant('other-tenant')).toBe(false);
    expect(findBlogCategoryLabelBySlug(['Review'], 'review')).toBe('Review');
    expect(findBlogCategoryLabelBySlug(['Reviews'], 'review')).toBeNull();
    expect(findBlogCategoryLabelBySlug(['Tech News'], 'news')).toBeNull();
    expect(buildBlogCategorySchemaUrl('https://ogabassey.com', 'Reviews')).toBe(
      'https://ogabassey.com/blog/category/reviews'
    );
    expect(
      buildBlogCategorySchemaUrl('https://ogabassey.com', 'Tech News')
    ).toBe('https://ogabassey.com/blog/category/tech-news');
  });

  it('detects colliding category slugs', () => {
    expect(
      getCollidingBlogCategorySlugs(['Cases & Covers', 'Cases Covers'])
    ).toEqual(new Set(['cases-covers']));
    expect(
      hasBlogCategorySlugCollision(
        ['Cases & Covers', 'Cases Covers'],
        'cases-covers'
      )
    ).toBe(true);
  });

  it('returns null for ambiguous category slugs', () => {
    expect(
      findBlogCategoryLabelBySlug(
        ['Cases & Covers', 'Cases Covers'],
        'cases-covers'
      )
    ).toBeNull();
  });

  it('returns null for unknown slugs', () => {
    expect(findBlogCategoryLabelBySlug(['Smartphones'], 'phones')).toBeNull();
  });

  it('returns null for proxy-blocked category slugs', () => {
    expect(findBlogCategoryLabelBySlug(['Product'], 'product')).toBeNull();
  });
});
