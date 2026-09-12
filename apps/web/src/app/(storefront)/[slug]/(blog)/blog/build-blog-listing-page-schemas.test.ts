import { describe, expect, it } from 'vitest';
import { buildBlogListingPageSchemas } from './build-blog-listing-page-schemas';

const post = {
  author_name: 'Editor',
  excerpt: 'Buyer notes',
  featured_image_url: 'https://cdn.example.com/cover.png',
  published_at: '2026-03-28T10:00:00.000Z',
  slug: 'first-post',
  title: 'First Post',
};

describe('buildBlogListingPageSchemas', () => {
  it('builds blog, item-list, and breadcrumb schema for the listing', () => {
    const schemas = buildBlogListingPageSchemas({
      baseUrl: 'https://ogabassey.com',
      currentPage: 1,
      isCleanCategoryRoute: false,
      merchantLogoUrl: 'https://cdn.example.com/logo.png',
      merchantName: 'Ogabassey',
      organizationId: 'https://ogabassey.com/#organization',
      posts: [post],
      totalPosts: 1,
    });

    expect(schemas.blogSchema.name).toBe('Ogabassey Blog');
    expect(schemas.blogSchema.blogPost[0]).toEqual(
      expect.objectContaining({
        headline: 'First Post',
        url: 'https://ogabassey.com/blog/first-post',
      })
    );
    expect(schemas.itemListSchema?.itemListElement[0]).toEqual(
      expect.objectContaining({
        position: 1,
        url: 'https://ogabassey.com/blog/first-post',
      })
    );
    expect(schemas.hasItemListSchemaSearch).toBe(false);
    expect(schemas.breadcrumbSchema).toEqual(
      expect.objectContaining({
        '@type': 'BreadcrumbList',
      })
    );
  });

  it('drops the category item-list url when a search query is active', () => {
    const schemas = buildBlogListingPageSchemas({
      baseUrl: 'https://ogabassey.com',
      category: 'News',
      currentPage: 1,
      isCleanCategoryRoute: true,
      itemListSchemaUrl: 'https://ogabassey.com/blog/category/news',
      merchantLogoUrl: null,
      merchantName: 'Ogabassey',
      organizationId: 'https://ogabassey.com/#organization',
      posts: [post],
      searchQuery: 'iphone',
      totalPosts: 1,
    });

    expect(schemas.hasItemListSchemaSearch).toBe(true);
    expect(schemas.itemListSchema?.url).toContain('search=iphone');
  });
});
