import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildListingResult,
  clusterCollections,
  merchant,
  mockBuildBlogClusterCollections,
  mockDefaultBlogUi,
  mockGetCachedBlogListing,
  mockHeaders,
  postsPayload,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';

const { BlogPageContent } = await import('./blog-page-content');

describe('BlogPageContent head and discovery', () => {
  beforeEach(() => {
    resetBlogPageContentMocks();
  });

  it('renders guide collections after the blog listing', async () => {
    mockBuildBlogClusterCollections.mockReturnValue(clusterCollections);

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      screen.getByRole('heading', { name: /guide collections/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Best Phones in Nigeria' })
    ).toHaveAttribute(
      'href',
      'https://ogabassey.com/blog/best-phones-in-nigeria'
    );
    const blogListing = screen.getByText('Ogabassey blog');
    const guideCollections = screen.getByRole('heading', {
      name: /guide collections/i,
    });
    const discoveryLinks = screen.getByRole('heading', {
      name: /continue exploring/i,
    });
    expect(
      blogListing.compareDocumentPosition(guideCollections) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      guideCollections.compareDocumentPosition(discoveryLinks) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders real prev/next head links for paginated listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          custom_domain: 'example.com',
        },
        totalPosts: 50,
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'example.com' }),
        searchParams: Promise.resolve({ page: '2', category: 'Guides' }),
      })
    );

    expect(document.head.querySelector('link[rel="prev"]')).toHaveAttribute(
      'href',
      'https://example.com/blog?category=Guides'
    );
    expect(document.head.querySelector('link[rel="next"]')).toHaveAttribute(
      'href',
      'https://example.com/blog?category=Guides&page=3'
    );
  });

  it('uses the provided canonical URL for ItemList schema URLs', async () => {
    render(
      await BlogPageContent({
        itemListSchemaUrl: 'https://example.com/blog/category/smartphones',
        params: Promise.resolve({ slug: 'example.com' }),
        searchParams: Promise.resolve({ category: 'Smartphones' }),
      })
    );

    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        itemListSchema: expect.objectContaining({
          url: 'https://example.com/blog/category/smartphones',
        }),
      })
    );
  });

  it('uses canonical storefront links without reading request headers for non-domain listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
        },
        totalPosts: 50,
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    );

    expect(mockHeaders).not.toHaveBeenCalled();
    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        basePath: 'https://ogabassey.usebaci.com',
        currentPage: 2,
        totalPosts: 50,
      })
    );
  });

  it('does not read request headers for custom-domain blog listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
          custom_domain: 'example.com',
        },
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'example.com' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockHeaders).not.toHaveBeenCalled();
    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        basePath: 'https://example.com',
      })
    );
  });

  it('preserves path-prefixed storefront origins in prev/next head links', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          store_url: 'http://localhost:3000/ogabassey',
        },
        totalPosts: 50,
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    );

    expect(document.head.querySelector('link[rel="prev"]')).toHaveAttribute(
      'href',
      'http://localhost:3000/ogabassey/blog'
    );
    expect(document.head.querySelector('link[rel="next"]')).toHaveAttribute(
      'href',
      'http://localhost:3000/ogabassey/blog?page=3'
    );
  });

  it('uses structured image variants and preserves listing pagination totals', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        totalPosts: 50,
      })
    );

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockDefaultBlogUi).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: ['News'],
        posts: [postsPayload[0]],
        totalPosts: 50,
      })
    );
    expect(mockDefaultBlogUi.mock.calls[0]?.[0].blogSchema.blogPost).toEqual([
      expect.objectContaining({
        image: [
          'https://cdn.example.com/blog-cover-16x9.png',
          'https://cdn.example.com/blog-cover-4x3.png',
          'https://cdn.example.com/blog-cover-1x1.png',
        ],
      }),
    ]);
    expect(mockDefaultBlogUi.mock.calls[0]?.[0].blogSchema.publisher).toEqual(
      expect.objectContaining({
        '@id': 'https://test-store.usebaci.com#organization',
      })
    );
  });
});
