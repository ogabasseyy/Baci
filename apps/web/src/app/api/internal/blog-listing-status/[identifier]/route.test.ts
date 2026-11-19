import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedStorefrontBlogListingStatus } from '@/lib/cached-storefront-blog-listing-status';
import { GET } from './route';

const { mockGetInternalApiSecret } = vi.hoisted(() => ({
  mockGetInternalApiSecret: vi.fn(() => 'test-internal-secret'),
}));

vi.mock('@/env', () => ({
  getInternalApiSecret: () => mockGetInternalApiSecret(),
}));

vi.mock('@/lib/cached-storefront-blog-listing-status', () => ({
  getCachedStorefrontBlogListingStatus: vi.fn(),
}));

function buildRequest(
  query: string,
  headers: Record<string, string> = {
    Authorization: 'Bearer test-internal-secret',
  }
) {
  const request = new NextRequest(
    `https://usebaci.com/api/internal/blog-listing-status/ogabassey?${query}`
  );
  for (const [name, value] of Object.entries(headers)) {
    request.headers.set(name, value);
  }
  return request;
}

function context(identifier = 'ogabassey') {
  return { params: Promise.resolve({ identifier }) };
}

const NOOP = {
  hasError: false,
  redirectPath: null,
  permanent: false,
  notFound: false,
};

describe('GET /api/internal/blog-listing-status/[identifier]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue('test-internal-secret');
    vi.mocked(getCachedStorefrontBlogListingStatus).mockResolvedValue(NOOP);
  });

  it('returns 500 when the internal secret is not configured', async () => {
    mockGetInternalApiSecret.mockReturnValue('');

    const response = await GET(
      buildRequest('kind=category-query&category=Smartphones'),
      context()
    );

    expect(response.status).toBe(500);
    expect(getCachedStorefrontBlogListingStatus).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before resolving status', async () => {
    const response = await GET(
      buildRequest('kind=category-query&category=Smartphones', {
        Authorization: 'Bearer wrong',
      }),
      context()
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(getCachedStorefrontBlogListingStatus).not.toHaveBeenCalled();
  });

  it('rejects a wrong custom internal auth header', async () => {
    const response = await GET(
      buildRequest('kind=category-query&category=Smartphones', {
        'x-baci-internal-auth': 'wrong',
      }),
      context()
    );

    expect(response.status).toBe(401);
    expect(getCachedStorefrontBlogListingStatus).not.toHaveBeenCalled();
  });

  it('accepts the custom internal auth header and edge-caches the NOOP verdict', async () => {
    const response = await GET(
      buildRequest('kind=category-query&category=Smartphones', {
        'x-baci-internal-auth': 'test-internal-secret',
      }),
      context()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(NOOP);
    expect(response.headers.get('Cache-Control')).toBe(
      's-maxage=300, stale-while-revalidate=3600'
    );
    expect(response.headers.get('Vary')).toBe('x-baci-internal-auth');
    expect(response.headers.get('Vercel-Cache-Tag')).toBe(
      'blog-listing-status-ogabassey'
    );
  });

  it('keeps the NOOP verdict no-store under legacy Bearer auth', async () => {
    const response = await GET(
      buildRequest('kind=category-query&category=Smartphones'),
      context()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(NOOP);
    // RFC 9111 lets a shared cache store an Authorization-request response
    // when s-maxage is present; only the custom-header path may be cacheable.
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('keeps notFound verdicts no-store so a since-published author page is never sticky', async () => {
    vi.mocked(getCachedStorefrontBlogListingStatus).mockResolvedValueOnce({
      hasError: false,
      redirectPath: null,
      permanent: false,
      notFound: true,
    });

    // Custom (cache-eligible) header so the no-store assertion proves the
    // notFound verdict shape is what disables caching, not the auth path.
    const response = await GET(
      buildRequest('kind=author&authorSlug=bassey-john', {
        'x-baci-internal-auth': 'test-internal-secret',
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('keeps unknown/unpublished-storefront NOOPs no-store so a publish flip is never suppressed', async () => {
    vi.mocked(getCachedStorefrontBlogListingStatus).mockResolvedValueOnce({
      hasError: false,
      redirectPath: null,
      permanent: false,
      notFound: false,
      unpublishedStorefront: true,
    });

    const response = await GET(
      buildRequest('kind=category-query&category=Smartphones', {
        'x-baci-internal-auth': 'test-internal-secret',
      }),
      context()
    );

    expect(response.status).toBe(200);
    // Publish-state changes purge merchant tags only (never `blog-posts`), so
    // a cached pre-publish NOOP would outlive the store going live.
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('returns 400 for an unknown kind', async () => {
    const response = await GET(buildRequest('kind=bogus'), context());

    expect(response.status).toBe(400);
    expect(getCachedStorefrontBlogListingStatus).not.toHaveBeenCalled();
  });

  it('returns 400 for a category-query missing its category', async () => {
    const response = await GET(buildRequest('kind=category-query'), context());

    expect(response.status).toBe(400);
    expect(getCachedStorefrontBlogListingStatus).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid route identifier', async () => {
    const response = await GET(
      buildRequest('kind=category-query&category=Smartphones'),
      context('   ')
    );

    expect(response.status).toBe(400);
    expect(getCachedStorefrontBlogListingStatus).not.toHaveBeenCalled();
  });

  it('coerces the page param and resolves a listing-page intent', async () => {
    vi.mocked(getCachedStorefrontBlogListingStatus).mockResolvedValueOnce({
      hasError: false,
      redirectPath: '/blog?page=3',
      permanent: false,
      notFound: false,
    });

    // Custom (cache-eligible) header so the no-store assertion proves the
    // REDIRECT verdict shape is what disables caching, not the auth path.
    const response = await GET(
      buildRequest('kind=listing-page&page=99', {
        'x-baci-internal-auth': 'test-internal-secret',
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      hasError: false,
      redirectPath: '/blog?page=3',
      permanent: false,
      notFound: false,
    });
    expect(getCachedStorefrontBlogListingStatus).toHaveBeenCalledWith(
      'ogabassey',
      { kind: 'listing-page', page: 99 }
    );
  });

  it('returns 400 for a page above the route cap (10_000)', async () => {
    const response = await GET(
      buildRequest('kind=listing-page&page=100000'),
      context()
    );

    expect(response.status).toBe(400);
    expect(getCachedStorefrontBlogListingStatus).not.toHaveBeenCalled();
  });

  it('defaults author page to 1 and forwards the intent', async () => {
    await GET(buildRequest('kind=author&authorSlug=bassey-john'), context());

    expect(getCachedStorefrontBlogListingStatus).toHaveBeenCalledWith(
      'ogabassey',
      { kind: 'author', authorSlug: 'bassey-john', page: 1 }
    );
  });

  it('fails open with a 200 body when the resolver throws', async () => {
    vi.mocked(getCachedStorefrontBlogListingStatus).mockRejectedValueOnce(
      new Error('boom')
    );

    // Custom (cache-eligible) header so the no-store assertion proves the
    // fail-open shape is what disables caching, not the auth path.
    const response = await GET(
      buildRequest('kind=category-query&category=Smartphones', {
        'x-baci-internal-auth': 'test-internal-secret',
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      hasError: true,
      redirectPath: null,
      permanent: false,
      notFound: false,
    });
  });
});
