import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildListingResult,
  merchant,
  mockDefaultBlogUi,
  mockGetCachedBlogListing,
  mockPermanentRedirect,
  mockRedirect,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';

const { BlogPageContent } = await import('./blog-page-content');

describe('BlogPageContent listing redirects', () => {
  beforeEach(() => {
    resetBlogPageContentMocks();
  });

  it('redirects out-of-range paginated listings to the last real page', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
        },
        totalPosts: 50,
        posts: [],
      })
    );

    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ page: '999', category: 'Guides' }),
      })
    ).rejects.toThrow(
      'NEXT_REDIRECT:https://ogabassey.usebaci.com/blog?category=Guides&page=5'
    );

    expect(mockRedirect).toHaveBeenCalledWith(
      'https://ogabassey.usebaci.com/blog?category=Guides&page=5'
    );
  });

  it('permanently redirects category-only query listings to the clean category hub', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
          custom_domain: 'ogabassey.com',
        },
        totalPosts: 10,
      })
    );

    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({ category: 'News' }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://ogabassey.com/blog/category/news'
    );

    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      'https://ogabassey.com/blog/category/news'
    );
  });

  it('uses a clean-route category override without needing category in search params', async () => {
    render(
      await BlogPageContent({
        categoryOverride: 'Smartphones',
        isCleanCategoryRoute: true,
        itemListSchemaUrl:
          'https://test-store.usebaci.com/blog/category/smartphones',
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('test-store', {
      category: 'Smartphones',
      page: 1,
      searchQuery: undefined,
    });
    expect(mockPermanentRedirect).not.toHaveBeenCalled();
  });

  it('permanently redirects slug-form category query values to the matching clean category hub', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
          custom_domain: 'ogabassey.com',
        },
        totalPosts: 10,
      }),
      categories: ['Buying Guides'],
    });

    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({ category: 'buying-guides' }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://ogabassey.com/blog/category/buying-guides'
    );

    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      'https://ogabassey.com/blog/category/buying-guides'
    );
  });

  it('permanently redirects repeated category query values without throwing', async () => {
    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ category: ['News', 'Updates'] }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://test-store.usebaci.com/blog/category/news'
    );

    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('ogabassey', {
      category: 'News',
      page: 1,
      searchQuery: undefined,
    });
  });

  it('preserves additional query parameters when redirecting category-only listings', async () => {
    await expect(
      BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({
          category: 'News',
          utm_source: 'newsletter',
          utm_medium: ['email', 'sms'],
        }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://test-store.usebaci.com/blog/category/news?utm_source=newsletter&utm_medium=email&utm_medium=sms'
    );

    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      'https://test-store.usebaci.com/blog/category/news?utm_source=newsletter&utm_medium=email&utm_medium=sms'
    );
  });

  it('keeps searched category query listings on the noindex query route', async () => {
    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ category: 'News', search: 'iphone' }),
      })
    );

    expect(mockPermanentRedirect).not.toHaveBeenCalled();
    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'News',
        searchQuery: 'iphone',
      })
    );
  });

  it('keeps category query listings when the clean category slug is reserved', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult(),
      categories: ['Product'],
    });

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ category: 'Product' }),
      })
    );

    expect(mockPermanentRedirect).not.toHaveBeenCalled();
    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'Product',
      })
    );
  });
});
