import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBlogAuthorPageContent,
  mockGetBlogAuthorBySlug,
  mockGetBlogAuthorSlugs,
  mockGetCachedBlogAuthor,
  mockNotFound,
  mockPermanentRedirect,
  mockRedirect,
  mockResolveBlogCatchAllOutcome,
} = vi.hoisted(() => ({
  mockBlogAuthorPageContent: vi.fn((_props: unknown) => <div>Author page</div>),
  mockGetBlogAuthorBySlug: vi.fn(),
  mockGetBlogAuthorSlugs: vi.fn(() => ['bassey-john', 'bolakale']),
  mockGetCachedBlogAuthor: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockPermanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
  }),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockResolveBlogCatchAllOutcome: vi.fn(),
}));

vi.mock('@/lib/blog-authors', () => ({
  getBlogAuthorBySlug: (...args: unknown[]) => mockGetBlogAuthorBySlug(...args),
  getBlogAuthorSlugs: () => mockGetBlogAuthorSlugs(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
  permanentRedirect: (url: string) => mockPermanentRedirect(url),
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock(
  '@/app/(storefront)/[slug]/(blog)/blog/[...catchAll]/blog-catch-all-resolution',
  () => ({
    resolveBlogCatchAllOutcome: (...args: unknown[]) =>
      mockResolveBlogCatchAllOutcome(...args),
  })
);

vi.mock('@/lib/cached-data', () => ({
  getCachedBlogAuthor: (...args: unknown[]) => mockGetCachedBlogAuthor(...args),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (merchant: { custom_domain?: string; slug: string }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
}));

vi.mock('./blog-author-page-content', () => ({
  BlogAuthorPageContent: (props: unknown) => mockBlogAuthorPageContent(props),
}));

const {
  default: BlogAuthorPage,
  generateMetadata,
  generateStaticParams,
} = await import('./page');

describe('blog author page metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBlogAuthorBySlug.mockReturnValue({
      name: 'Bassey John',
      sameAs: ['https://www.linkedin.com/in/bassey-john-6a277885'],
    });
    mockResolveBlogCatchAllOutcome.mockResolvedValue({ type: 'notFound' });
    mockGetCachedBlogAuthor.mockResolvedValue({
      merchant: {
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
      },
      author: {
        name: 'Bassey John',
        title: 'Performance Marketing Specialist',
        bio: 'Bassey John writes practical device buying guides.',
        imageUrl: 'https://cdn.ogabassey.com/authors/bassey-john.jpg',
      },
    });
  });

  it('passes the tenant identifier before resolving hardcoded author profiles', async () => {
    await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey.com',
        authorSlug: 'Bassey-John',
      }),
    });

    expect(mockGetBlogAuthorBySlug).toHaveBeenCalledWith(
      'bassey-john',
      'ogabassey.com'
    );
  });

  it('returns profile metadata for a known author with published posts', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey.com',
        authorSlug: 'bassey-john',
      }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toBe(
      'Bassey John — Performance Marketing Specialist at Ogabassey'
    );
    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog/author/bassey-john'
    );
    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://cdn.ogabassey.com/authors/bassey-john.jpg',
        alt: 'Bassey John',
      },
    ]);
  });

  it('returns noindex metadata when the tenant-scoped author profile is unknown', async () => {
    mockGetBlogAuthorBySlug.mockReturnValueOnce(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'another-store',
        authorSlug: 'bassey-john',
      }),
    });

    expect(metadata).toEqual({
      title: 'Author Not Found',
      robots: { index: false, follow: false },
    });
    expect(mockGetCachedBlogAuthor).not.toHaveBeenCalled();
  });

  it('generates static params for known OgaBassey author hubs', () => {
    expect(generateStaticParams()).toContainEqual({
      slug: 'ogabassey.com',
      authorSlug: 'bassey-john',
    });
  });

  it('renders known OgaBassey author content directly as crawlable static HTML', async () => {
    render(
      await BlogAuthorPage({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          authorSlug: 'bassey-john',
        }),
        searchParams: Promise.resolve({}),
      })
    );

    // Static tenant author content lands in the initial payload (not behind
    // the loading fallback), so crawlers see it without JS.
    expect(screen.getByText('Author page')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Loading blog posts' })
    ).not.toBeInTheDocument();
  });

  it('renders known author content for a non-static tenant after the pre-shell status check', async () => {
    render(
      await BlogAuthorPage({
        params: Promise.resolve({
          slug: 'dynamic-store',
          authorSlug: 'bassey-john',
        }),
        searchParams: Promise.resolve({ page: '99' }),
      })
    );

    // Known author passes assertNonStaticAuthorRouteBeforeShell (no redirect/
    // notFound) and renders inside the fallback-wrapped shell.
    expect(screen.getByText('Author page')).toBeInTheDocument();
  });

  it('forwards request search params to non-static author content so ?page pagination works', async () => {
    const requestSearchParams = Promise.resolve({ page: '2' });

    render(
      await BlogAuthorPage({
        params: Promise.resolve({
          slug: 'dynamic-store',
          authorSlug: 'bassey-john',
        }),
        searchParams: requestSearchParams,
      })
    );

    expect(mockBlogAuthorPageContent).toHaveBeenCalledWith(
      expect.objectContaining({ searchParams: requestSearchParams })
    );
  });

  it('shows the author fallback while dynamic author content is resolving', async () => {
    mockBlogAuthorPageContent.mockImplementation(() => {
      throw new Promise(() => {
        // Intentionally never resolves so Suspense fallback remains visible.
      });
    });

    render(
      await BlogAuthorPage({
        params: Promise.resolve({
          slug: 'dynamic-store',
          authorSlug: 'bassey-john',
        }),
        searchParams: Promise.resolve({ page: '99' }),
      })
    );

    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
    expect(mockGetCachedBlogAuthor).not.toHaveBeenCalled();
  });

  it('permanently redirects legacy author-prefixed URLs before streaming dynamic tenant shells', async () => {
    mockGetBlogAuthorBySlug.mockReturnValueOnce(null);
    mockResolveBlogCatchAllOutcome.mockResolvedValueOnce({
      type: 'redirect',
      status: 308,
      url: 'https://dynamic-store.usebaci.com/blog/legacy-post',
    });

    await expect(
      BlogAuthorPage({
        params: Promise.resolve({
          slug: 'dynamic-store',
          authorSlug: 'legacy-post',
        }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://dynamic-store.usebaci.com/blog/legacy-post'
    );

    expect(mockResolveBlogCatchAllOutcome).toHaveBeenCalledWith({
      params: expect.any(Promise),
    });
    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      'https://dynamic-store.usebaci.com/blog/legacy-post'
    );
    expect(mockBlogAuthorPageContent).not.toHaveBeenCalled();
    expect(mockGetCachedBlogAuthor).not.toHaveBeenCalled();
  });

  it('returns notFound for unknown dynamic author routes before streaming the shell', async () => {
    mockGetBlogAuthorBySlug.mockReturnValueOnce(null);
    mockResolveBlogCatchAllOutcome.mockResolvedValueOnce({ type: 'notFound' });

    await expect(
      BlogAuthorPage({
        params: Promise.resolve({
          slug: 'dynamic-store',
          authorSlug: 'nobody',
        }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockResolveBlogCatchAllOutcome).toHaveBeenCalledWith({
      params: expect.any(Promise),
    });
    expect(mockNotFound).toHaveBeenCalled();
    expect(mockBlogAuthorPageContent).not.toHaveBeenCalled();
    expect(mockGetCachedBlogAuthor).not.toHaveBeenCalled();
  });

  it('does not resolve author search params before rendering the route shell', async () => {
    const thenSpy = vi.fn(() => {
      throw new Error('author search params resolved before content render');
    });
    const searchParams = Object.defineProperty({}, 'then', {
      value: thenSpy,
    }) as Promise<{ page?: string }>;

    await BlogAuthorPage({
      params: Promise.resolve({
        slug: 'ogabassey.com',
        authorSlug: 'bassey-john',
      }),
      searchParams,
    });

    expect(thenSpy).not.toHaveBeenCalled();
    expect(mockBlogAuthorPageContent).not.toHaveBeenCalled();
    expect(mockResolveBlogCatchAllOutcome).not.toHaveBeenCalled();
  });

  it('builds request-searchParams-free canonical author metadata (page 1)', async () => {
    const thenSpy = vi.fn(() => {
      throw new Error('author metadata resolved request search params');
    });
    const requestSearchParams = Object.defineProperty({}, 'then', {
      value: thenSpy,
    }) as Promise<{ page?: string }>;

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey.com',
        authorSlug: 'bassey-john',
      }),
      searchParams: requestSearchParams,
    });

    // Canonical author metadata is always the clean page-1 URL and indexable;
    // pagination dedupes via this canonical rather than a request-derived one.
    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog/author/bassey-john'
    );
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(mockGetCachedBlogAuthor).toHaveBeenCalledWith(
      'ogabassey.com',
      'Bassey John',
      { page: 1 }
    );
    expect(thenSpy).not.toHaveBeenCalled();
  });

  it('reads ?page for non-static author metadata (page-scoped noindex variant)', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'another-store',
        authorSlug: 'bassey-john',
      }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog/author/bassey-john?page=2'
    );
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(mockGetCachedBlogAuthor).toHaveBeenCalledWith(
      'another-store',
      'Bassey John',
      { page: 2 }
    );
  });

  it('returns noindex metadata when a known author has no published posts', async () => {
    mockGetCachedBlogAuthor.mockResolvedValueOnce(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey.com',
        authorSlug: 'bassey-john',
      }),
    });

    expect(metadata).toEqual({
      title: 'Author Not Found',
      robots: { index: false, follow: false },
    });
    expect(mockGetCachedBlogAuthor).toHaveBeenCalledWith(
      'ogabassey.com',
      'Bassey John',
      { page: 1 }
    );
  });
});
