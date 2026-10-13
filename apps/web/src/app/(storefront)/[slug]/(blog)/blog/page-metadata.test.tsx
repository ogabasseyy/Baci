import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildListingResult,
  merchant,
  mockGetCachedBlogListing,
  postsPayload,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';
import { generateMetadata } from './page';

describe('blog page metadata', () => {
  beforeEach(() => {
    resetBlogPageContentMocks();
  });

  it('includes social images for the blog listing metadata', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://cdn.example.com/blog-cover.png',
        alt: 'Ogabassey blog',
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      'https://cdn.example.com/blog-cover.png',
    ]);
  });

  it('falls back to the storefront opengraph image when blog posts have no media', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        posts: [{ ...postsPayload[0], featured_image_url: '' }],
      })
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://test-store.usebaci.com/opengraph-image',
        alt: 'Ogabassey blog',
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      'https://test-store.usebaci.com/opengraph-image',
    ]);
  });

  it('builds route-specific canonical metadata for the blog listing', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toEqual({ absolute: 'Blog | Ogabassey' });
    expect(String(metadata.description).length).toBeGreaterThan(30);
    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/blog'
    );
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  // The STATIC tenant's metadata must stay request-searchParams-free so its
  // shell prerenders and Googlebot receives the resolved <title>.
  it('does not read request search params for the static tenant metadata', async () => {
    const thenSpy = vi.fn(() => {
      throw new Error('static metadata resolved request search params');
    });
    const requestSearchParams = Object.defineProperty({}, 'then', {
      value: thenSpy,
    }) as Promise<{ page?: string; search?: string; category?: string }>;

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: requestSearchParams,
    });

    expect(metadata.title).toEqual({ absolute: 'Blog | Ogabassey' });
    expect(String(metadata.alternates?.canonical)).toContain('/blog');
    expect(thenSpy).not.toHaveBeenCalled();
  });

  // Non-static tenants render dynamically, so their metadata reads searchParams
  // to keep the builder's query-specific noindex/self-canonical variants.
  it('reads request search params for non-static tenant metadata variants', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({ totalPosts: 50 })
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    expect(metadata.title).toEqual({ absolute: 'Blog | Page 2 | Ogabassey' });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('test-store', {
      page: 2,
    });
  });

  it('uses a self-canonical URL for paginated blog listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'ogabassey',
          custom_domain: 'example.com',
        },
        totalPosts: 50,
      })
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'example.com' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://example.com/blog?page=2'
    );
    expect(metadata.openGraph?.url).toBe('https://example.com/blog?page=2');
    expect(metadata.title).toEqual({ absolute: 'Blog | Page 2 | Ogabassey' });
    expect(metadata.description).toContain('Page 2:');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.other).toBeUndefined();
    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('example.com', {
      page: 2,
    });
  });

  it('uses distinct noindex metadata for filtered blog listings', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ category: 'buying-guides' }),
    });

    expect(metadata.title).toEqual({
      absolute: 'Buying Guides Articles | Ogabassey',
    });
    expect(metadata.description).toContain('buying guides articles');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('test-store', {
      category: 'buying-guides',
      page: 1,
    });
  });

  it('uses distinct noindex metadata for blog search listings', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ search: 'iphone-reviews' }),
    });

    expect(metadata.title).toEqual({
      absolute: 'Search: iphone reviews | Ogabassey',
    });
    expect(metadata.description).toContain(
      'Search results for "iphone reviews"'
    );
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('test-store', {
      page: 1,
      searchQuery: 'iphone-reviews',
    });
  });

  it('uses the first repeated blog search parameter without throwing', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({ totalPosts: 50 })
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({
        category: ['buying-guides', 'tablets'],
        page: ['2', '3'],
        search: ['iphone-reviews', 'ipad-reviews'],
      }),
    });

    expect(metadata.title).toEqual({
      absolute: 'Search: iphone reviews | Page 2 | Ogabassey',
    });
    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/blog?category=buying-guides&search=iphone-reviews&page=2'
    );
    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('test-store', {
      category: 'buying-guides',
      page: 2,
      searchQuery: 'iphone-reviews',
    });
  });

  it('caps long filtered metadata titles without changing the listing query', async () => {
    const longSearch =
      'iphone-reviews-for-used-flagship-smartphones-in-nigeria-under-budget';

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ search: longSearch }),
    });

    const title = (metadata.title as { absolute: string }).absolute;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toContain('Ogabassey');
    expect(mockGetCachedBlogListing).toHaveBeenCalledWith('test-store', {
      page: 1,
      searchQuery: longSearch,
    });
  });

  it('preserves storefront path prefixes in paginated metadata URLs', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          slug: 'path-store',
          store_url: 'http://localhost:3000/ogabassey',
        },
        totalPosts: 50,
      })
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'path-store' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'http://localhost:3000/ogabassey/blog?page=2'
    );
    expect(metadata.openGraph?.url).toBe(
      'http://localhost:3000/ogabassey/blog?page=2'
    );
  });

  it('clamps invalid page params back to the first page metadata', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({ page: '0' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/blog'
    );
    expect(metadata.openGraph?.url).toBe('https://test-store.usebaci.com/blog');
  });

  it('returns fallback metadata when the merchant is missing', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'missing-store' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata).toEqual({
      title: 'Blog Not Found',
      robots: { index: false, follow: false },
    });
  });

  it('returns fallback metadata when the merchant blog is disabled', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata).toEqual({
      title: 'Blog Not Found',
      robots: { index: false, follow: false },
    });
  });
});
