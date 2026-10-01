import { type RenderResult, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';
import {
  buildListingResult,
  merchant,
  mockGetCachedBlogListing,
  mockOgabasseyV2Blog,
  mockTemplateBlogRenderer,
  postsPayload,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';

const { BlogPageContent } = await import('./blog-page-content');

function getRenderedItemListSchema(container: RenderResult['container']) {
  return Array.from(
    container.querySelectorAll('script[type="application/ld+json"]')
  )
    .map(
      (script) =>
        JSON.parse(script.textContent || '{}') as Record<string, unknown>
    )
    .find((schema) => schema['@type'] === 'ItemList');
}

describe('BlogPageContent ItemList schema', () => {
  beforeEach(() => {
    resetBlogPageContentMocks();
  });

  it('passes an ItemList schema for crawlable blog listing entities', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          template_id: 'modern',
        },
      })
    );

    const { container } = render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(getRenderedItemListSchema(container)).toEqual(
      expect.objectContaining({
        '@type': 'ItemList',
        name: 'Ogabassey Blog articles',
        numberOfItems: 1,
        url: 'https://test-store.usebaci.com/blog',
        itemListElement: [
          expect.objectContaining({
            '@type': 'ListItem',
            position: 1,
            url: 'https://test-store.usebaci.com/blog/first-post',
            name: 'First Post',
          }),
        ],
      })
    );
  });

  it('omits ItemList schema when the blog listing has no posts', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          template_id: 'modern',
        },
        posts: [],
        totalPosts: 0,
      })
    );

    const { container } = render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(getRenderedItemListSchema(container)).toBeUndefined();
  });

  it('matches ItemList URL and positions to filtered paginated listing URLs', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          store_url: 'http://localhost:3000/ogabassey',
          template_id: 'modern',
        },
        totalPosts: 25,
      })
    );

    const { container } = render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({
          category: 'News',
          page: '2',
          search: 'phone launch',
        }),
      })
    );

    expect(getRenderedItemListSchema(container)).toEqual(
      expect.objectContaining({
        url: 'http://localhost:3000/ogabassey/blog?category=News&search=phone+launch&page=2',
        numberOfItems: 25,
        itemListElement: [
          expect.objectContaining({
            position: BLOG_LISTING_PAGE_SIZE + 1,
            url: 'http://localhost:3000/ogabassey/blog/first-post',
          }),
        ],
      })
    );
  });

  it('uses filtered URLs instead of clean category canonicals for searched category listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          template_id: 'modern',
        },
      })
    );

    const { container } = render(
      await BlogPageContent({
        isCleanCategoryRoute: true,
        itemListSchemaUrl:
          'https://test-store.usebaci.com/blog/category/smartphones',
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({
          category: 'Smartphones',
          search: 'iphone',
        }),
      })
    );

    expect(getRenderedItemListSchema(container)).toEqual(
      expect.objectContaining({
        url: 'https://test-store.usebaci.com/blog?category=Smartphones&search=iphone',
      })
    );
  });

  it('keeps the clean category ItemList canonical for blank searches', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          template_id: 'modern',
        },
      })
    );

    const { container } = render(
      await BlogPageContent({
        isCleanCategoryRoute: true,
        itemListSchemaUrl:
          'https://test-store.usebaci.com/blog/category/smartphones',
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({
          category: 'Smartphones',
          search: '   ',
        }),
      })
    );

    expect(getRenderedItemListSchema(container)).toEqual(
      expect.objectContaining({
        url: 'https://test-store.usebaci.com/blog/category/smartphones',
      })
    );
  });

  it('uses the filtered total count when positions are global across pagination', async () => {
    const posts = Array.from({ length: 15 }, (_, index) => ({
      ...postsPayload[0],
      id: `post-${index + 1}`,
      title: `Post ${index + 1}`,
      slug: `post-${index + 1}`,
    }));

    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          template_id: 'modern',
        },
        posts,
        totalPosts: posts.length,
      })
    );

    const { container } = render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    const itemListSchema = getRenderedItemListSchema(container);

    expect(itemListSchema).toEqual(
      expect.objectContaining({
        numberOfItems: 15,
        itemListElement: expect.arrayContaining([
          expect.objectContaining({
            position: 1,
            name: 'Post 1',
          }),
          expect.objectContaining({
            position: 10,
            name: 'Post 10',
          }),
        ]),
      })
    );
    expect(itemListSchema?.itemListElement).toHaveLength(10);
  });

  it('omits ItemList schema for template search results when the template may hide entries', async () => {
    mockOgabasseyV2Blog.mockImplementation(() => <div>Template component</div>);

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ search: 'phone' }),
      })
    );

    expect(mockTemplateBlogRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        itemListSchema: undefined,
      })
    );
  });
});
