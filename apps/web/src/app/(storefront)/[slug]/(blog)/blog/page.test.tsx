import { render, screen } from '@testing-library/react';
import { isValidElement, Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildListingResult,
  merchant,
  mockGetCachedBlogListing,
  postsPayload,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';

const mockBlogPageContent = vi.hoisted(() =>
  vi.fn((_props: unknown) => <div>Blog page content</div>)
);

vi.mock('./blog-listing-static-hero', () => ({
  BlogListingStaticHero: () => <div>Static listing hero</div>,
}));

vi.mock('./blog-page-content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./blog-page-content')>();

  return {
    ...actual,
    BlogPageContent: (props: unknown) => mockBlogPageContent(props),
  };
});

const {
  default: BlogPage,
  generateMetadata,
  generateStaticParams,
} = await import('./page');

describe('blog page shell', () => {
  beforeEach(() => {
    resetBlogPageContentMocks();
    mockBlogPageContent.mockReset();
    mockBlogPageContent.mockReturnValue(<div>Blog page content</div>);
  });

  it('generates static params for the monitored OgaBassey blog listing', () => {
    expect(generateStaticParams()).toContainEqual({ slug: 'ogabassey.com' });
  });

  it('keeps the listing hero outside Suspense so PPR cannot hide it behind a null fallback', () => {
    const ui = BlogPage({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
      searchParams: Promise.resolve({}),
    });

    expect(isValidElement<{ children?: unknown }>(ui)).toBe(true);
    if (!isValidElement<{ children?: unknown }>(ui)) {
      return;
    }

    const children = Array.isArray(ui.props.children)
      ? ui.props.children
      : [ui.props.children];

    expect(isValidElement(children[0])).toBe(true);
    expect(isValidElement(children[1])).toBe(true);
    if (!isValidElement(children[0]) || !isValidElement(children[1])) {
      return;
    }

    expect(children[0].type).not.toBe(Suspense);
    expect(children[1].type).toBe(Suspense);
  });

  it('renders the static OgaBassey listing content and forwards its request search params', async () => {
    const requestSearchParams = Promise.resolve({ search: 'iphone' });

    render(
      await BlogPage({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: requestSearchParams,
      })
    );

    // Static tenant hero is a sibling of the listing Suspense slot so PPR can
    // prerender the featured image into the visible shell instead of a hole.
    expect(screen.getByText('Static listing hero')).toBeInTheDocument();
    expect(screen.getByText('Blog page content')).toBeInTheDocument();
    expect(mockBlogPageContent).toHaveBeenCalledWith(
      expect.objectContaining({
        hideFeaturedStory: true,
        searchParams: requestSearchParams,
      })
    );
  });

  it('builds the route shell without synchronously resolving request search params', async () => {
    const thenSpy = vi.fn(() => {
      throw new Error('search params resolved before content render');
    });
    const searchParams = Object.defineProperty({}, 'then', {
      value: thenSpy,
    }) as Promise<Record<string, never>>;

    await BlogPage({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
      searchParams,
    });

    // The route shell function forwards searchParams into the Suspense boundary
    // without awaiting it, so the shell is creatable without request data (the
    // content reads it behind Suspense at request time).
    expect(thenSpy).not.toHaveBeenCalled();
    expect(mockBlogPageContent).not.toHaveBeenCalled();
  });

  it('builds the route shell without resolving dynamic tenant params', async () => {
    const thenSpy = vi.fn(() => {
      throw new Error('dynamic tenant params resolved before content render');
    });
    const params = Object.defineProperty({}, 'then', {
      value: thenSpy,
    }) as Promise<{ slug: string }>;

    await BlogPage({
      params,
      searchParams: Promise.resolve({}),
    });

    // Unknown tenant params are request-bound during prerendering. Reading them
    // above Suspense prevents Next.js from producing any static shell.
    expect(thenSpy).not.toHaveBeenCalled();
    expect(mockBlogPageContent).not.toHaveBeenCalled();
  });

  it('shows the blog listing fallback while dynamic tenant content is resolving', async () => {
    mockBlogPageContent.mockImplementation(() => {
      throw new Promise(() => {
        // Intentionally never resolves so Suspense fallback remains visible.
      });
    });

    render(
      await BlogPage({
        params: Promise.resolve({ slug: 'dynamic-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.getByText('Static listing hero')).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
  });

  it('forwards request search params to non-static tenant content so pagination/search keep working', async () => {
    const requestSearchParams = Promise.resolve({ page: '2' });

    render(
      await BlogPage({
        params: Promise.resolve({ slug: 'dynamic-store' }),
        searchParams: requestSearchParams,
      })
    );

    // Non-static tenants render dynamically behind Suspense; the request
    // searchParams must reach the content so page/search/category still drive it.
    expect(mockBlogPageContent).toHaveBeenCalledWith(
      expect.objectContaining({
        hideFeaturedStory: true,
        searchParams: requestSearchParams,
      })
    );
  });
});

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
