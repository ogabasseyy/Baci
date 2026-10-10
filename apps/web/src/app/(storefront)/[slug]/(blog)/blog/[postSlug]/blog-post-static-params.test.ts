import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCachedBlogListing } = vi.hoisted(() => ({
  mockGetCachedBlogListing: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedBlogListing: (...args: unknown[]) =>
    mockGetCachedBlogListing(...args),
}));

vi.mock('@/lib/blog-listing-page-size', () => ({
  BLOG_LISTING_PAGE_SIZE: 12,
}));

vi.mock('../blog-category-routing', () => ({
  OGABASSEY_BLOG_STATIC_TENANTS: ['ogabassey.com', 'ogabassey'],
}));

import {
  BLOG_POST_PRERENDER_LIMIT,
  BLOG_POST_PRERENDER_PLACEHOLDER_POST_SLUG,
  BLOG_POST_PRERENDER_PLACEHOLDER_STORE_SLUG,
  BLOG_POST_PREVIEW_PRERENDER_LIMIT,
  resolveBlogPostStaticParams,
} from './blog-post-static-params';

function listingForPage(page: number, count: number) {
  return {
    merchant: { id: 'm1' },
    posts: Array.from({ length: count }, (_, index) => ({
      slug: `post-${page}-${index}`,
    })),
  };
}

describe('resolveBlogPostStaticParams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pins the prerender ceiling to a whole number of listing pages', () => {
    // The ceiling must comfortably exceed the published-post count (526 as of
    // 2026-07-10) so EVERY published post gets a prerendered shell — shell
    // coverage is what bakes the real <title> into <head> for crawlers.
    expect(BLOG_POST_PRERENDER_LIMIT).toBe(1200);
    expect(BLOG_POST_PRERENDER_LIMIT % 12).toBe(0);
  });

  it('emits { slug, postSlug } pairs for each static tenant', async () => {
    mockGetCachedBlogListing.mockResolvedValue(listingForPage(1, 3));

    const params = await resolveBlogPostStaticParams();

    // Page 1 short-circuits paging (3 < 12) → 3 posts per tenant, 2 tenants.
    expect(params).toEqual([
      { slug: 'ogabassey.com', postSlug: 'post-1-0' },
      { slug: 'ogabassey.com', postSlug: 'post-1-1' },
      { slug: 'ogabassey.com', postSlug: 'post-1-2' },
      { slug: 'ogabassey', postSlug: 'post-1-0' },
      { slug: 'ogabassey', postSlug: 'post-1-1' },
      { slug: 'ogabassey', postSlug: 'post-1-2' },
    ]);
    // One fetch per tenant since page 1 was not full.
    expect(mockGetCachedBlogListing).toHaveBeenCalledTimes(2);
  });

  it('caps each tenant at the prerender ceiling and stops paging there', async () => {
    mockGetCachedBlogListing.mockImplementation(
      async (_tenant: string, options: { page: number }) =>
        listingForPage(options.page, 12)
    );

    const params = await resolveBlogPostStaticParams();

    // Ceiling posts per tenant × 2 tenants, never fetching a page past the
    // ceiling (pages-per-tenant derived from the constant, not re-pinned).
    const pagesPerTenant = BLOG_POST_PRERENDER_LIMIT / 12;
    expect(params).toHaveLength(BLOG_POST_PRERENDER_LIMIT * 2);
    expect(mockGetCachedBlogListing).toHaveBeenCalledTimes(pagesPerTenant * 2);
    const requestedPages = mockGetCachedBlogListing.mock.calls.map(
      (call) => (call[1] as { page: number }).page
    );
    expect(Math.max(...requestedPages)).toBe(pagesPerTenant);
  });

  it('excludes posts whose slug is empty or whitespace-only', async () => {
    mockGetCachedBlogListing.mockResolvedValue({
      merchant: { id: 'm1' },
      posts: [
        { slug: '   ' },
        { slug: '' },
        { slug: 'real-post' },
        { slug: undefined },
      ],
    });

    const params = await resolveBlogPostStaticParams();

    // Blank / whitespace-only / missing slugs are dropped; only the real slug
    // is prerendered for each static tenant.
    expect(params).toEqual([
      { slug: 'ogabassey.com', postSlug: 'real-post' },
      { slug: 'ogabassey', postSlug: 'real-post' },
    ]);
  });

  it('falls back to a single placeholder param when no posts exist', async () => {
    mockGetCachedBlogListing.mockResolvedValue(null);

    const params = await resolveBlogPostStaticParams();

    expect(params).toEqual([
      {
        slug: BLOG_POST_PRERENDER_PLACEHOLDER_STORE_SLUG,
        postSlug: BLOG_POST_PRERENDER_PLACEHOLDER_POST_SLUG,
      },
    ]);
  });

  it('falls back to the placeholder AND warns when every listing lookup rejects', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const outage = new Error('build-time outage');
    mockGetCachedBlogListing.mockRejectedValue(outage);

    try {
      const params = await resolveBlogPostStaticParams();

      expect(params).toEqual([
        {
          slug: BLOG_POST_PRERENDER_PLACEHOLDER_STORE_SLUG,
          postSlug: BLOG_POST_PRERENDER_PLACEHOLDER_POST_SLUG,
        },
      ]);
      // The build-time failure must not be swallowed silently.
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to collect blog post static params for tenant',
        expect.objectContaining({ tenant: 'ogabassey.com', error: outage })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('pins the preview ceiling to one listing page per tenant', () => {
    expect(BLOG_POST_PREVIEW_PRERENDER_LIMIT).toBe(12);
    expect(BLOG_POST_PREVIEW_PRERENDER_LIMIT % 12).toBe(0);
    expect(BLOG_POST_PREVIEW_PRERENDER_LIMIT).toBeLessThan(
      BLOG_POST_PRERENDER_LIMIT
    );
  });

  it('caps each preview tenant to one listing page', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    try {
      mockGetCachedBlogListing.mockImplementation(
        async (_tenant: string, options: { page: number }) =>
          listingForPage(options.page, 12)
      );

      const params = await resolveBlogPostStaticParams();

      // Preview ceiling per tenant × 2 tenants, one fetch per tenant. The
      // full ceiling would emit tens of thousands of cold files that never
      // finish the preview finalize step.
      expect(params).toHaveLength(BLOG_POST_PREVIEW_PRERENDER_LIMIT * 2);
      expect(mockGetCachedBlogListing).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the full ceiling when VERCEL_ENV is production', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    try {
      mockGetCachedBlogListing.mockImplementation(
        async (_tenant: string, options: { page: number }) =>
          listingForPage(options.page, 12)
      );

      const params = await resolveBlogPostStaticParams();

      // Production must never see the preview cap: full ceiling per tenant.
      expect(params).toHaveLength(BLOG_POST_PRERENDER_LIMIT * 2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('still prerenders healthy tenants and warns when one tenant listing throws', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const outage = new Error('tenant outage');
    mockGetCachedBlogListing.mockImplementation((tenant: string) => {
      if (tenant === 'ogabassey.com') {
        return Promise.reject(outage);
      }
      return Promise.resolve(listingForPage(1, 2));
    });

    try {
      const params = await resolveBlogPostStaticParams();

      // The failing tenant is skipped, but the healthy tenant's posts still ship.
      expect(params).toEqual([
        { slug: 'ogabassey', postSlug: 'post-1-0' },
        { slug: 'ogabassey', postSlug: 'post-1-1' },
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to collect blog post static params for tenant',
        expect.objectContaining({ tenant: 'ogabassey.com', error: outage })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
