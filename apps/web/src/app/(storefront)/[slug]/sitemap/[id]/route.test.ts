import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeHeadersState = vi.hoisted(() => ({
  current: new Headers(),
}));

const mockResolveStorefrontSitemapContext = vi.fn();
const mockGetNamedSitemapEntries = vi.fn();
const mockGetSitemapIndexLinks = vi.fn();
const mockCreateSitemapResponse = vi.fn();
const mockCreateSitemapIndexResponse = vi.fn();
const mockCreateSitemapUnavailableResponse = vi.fn();
const mockCreateSitemapNotFoundResponse = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(routeHeadersState.current),
}));

vi.mock('../../sitemap-data', () => ({
  resolveStorefrontSitemapContextResult: (...args: unknown[]) =>
    mockResolveStorefrontSitemapContext(...args),
  getNamedSitemapEntries: (...args: unknown[]) =>
    mockGetNamedSitemapEntries(...args),
  getSitemapIndexLinks: (...args: unknown[]) =>
    mockGetSitemapIndexLinks(...args),
  createSitemapResponse: (...args: unknown[]) =>
    mockCreateSitemapResponse(...args),
  createSitemapIndexResponse: (...args: unknown[]) =>
    mockCreateSitemapIndexResponse(...args),
  createSitemapUnavailableResponse: (...args: unknown[]) =>
    mockCreateSitemapUnavailableResponse(...args),
  createSitemapNotFoundResponse: (...args: unknown[]) =>
    mockCreateSitemapNotFoundResponse(...args),
}));

describe('GET /[slug]/sitemap/[id].xml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeHeadersState.current = new Headers();
    mockCreateSitemapResponse.mockImplementation(
      (entries: unknown[]) =>
        new Response(JSON.stringify(entries), {
          headers: { 'content-type': 'application/xml; charset=utf-8' },
        })
    );
    mockCreateSitemapIndexResponse.mockImplementation(
      (links: string[]) =>
        new Response(links.join('\n'), {
          headers: { 'content-type': 'application/xml; charset=utf-8' },
        })
    );
    mockCreateSitemapUnavailableResponse.mockImplementation(
      () =>
        new Response('Service Unavailable', {
          status: 503,
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'no-store',
            'retry-after': '300',
          },
        })
    );
    mockCreateSitemapNotFoundResponse.mockImplementation(
      () =>
        new Response('Not Found', {
          status: 404,
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'no-store',
          },
        })
    );
  });

  it('returns a named storefront sitemap response', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: { merchant: { id: 'm1' } },
    });
    mockGetNamedSitemapEntries.mockResolvedValue([
      { url: 'https://ogabassey.com/smartphones' },
    ]);

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://ogabassey.com/ogabassey/sitemap/categories.xml'),
      { params: Promise.resolve({ slug: 'ogabassey', id: 'categories' }) }
    );
    const body = await response.text();

    expect(mockResolveStorefrontSitemapContext).toHaveBeenCalledWith(
      expect.any(Headers),
      'ogabassey',
      expect.any(Request)
    );
    expect(mockGetNamedSitemapEntries).toHaveBeenCalledWith(
      { merchant: { id: 'm1' } },
      'categories'
    );
    expect(body).toContain('https://ogabassey.com/smartphones');
  });

  it('uses request-scoped headers for custom-domain sitemap rewrites', async () => {
    routeHeadersState.current = new Headers([
      ['x-merchant-domain', 'ogabassey.com'],
    ]);
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: { merchant: { id: 'm1' } },
    });
    mockGetNamedSitemapEntries.mockResolvedValue([
      { url: 'https://ogabassey.com/laptops' },
    ]);

    const { GET } = await import('./route');
    await GET(
      new Request('https://ogabassey.com/ogabassey/sitemap/categories.xml'),
      { params: Promise.resolve({ slug: 'ogabassey', id: 'categories' }) }
    );

    expect(mockResolveStorefrontSitemapContext).toHaveBeenCalledWith(
      routeHeadersState.current,
      'ogabassey',
      expect.any(Request)
    );
  });

  it('normalizes .xml suffixes from live route params', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: { merchant: { id: 'm1' } },
    });
    mockGetNamedSitemapEntries.mockResolvedValue([
      { url: 'https://ogabassey.com/smartphones/iphone-17-pro' },
    ]);

    const { GET } = await import('./route');
    await GET(
      new Request('https://ogabassey.com/ogabassey/sitemap/products.xml'),
      { params: Promise.resolve({ slug: 'ogabassey', id: 'products.xml' }) }
    );

    expect(mockGetNamedSitemapEntries).toHaveBeenCalledWith(
      { merchant: { id: 'm1' } },
      'products'
    );
  });

  it('returns a sitemap index referencing child sitemaps for root.xml rewrites', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: { merchant: { id: 'm1' } },
    });
    mockGetSitemapIndexLinks.mockResolvedValue([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
    ]);

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://ogabassey.com/ogabassey/sitemap/root.xml'),
      { params: Promise.resolve({ slug: 'ogabassey', id: 'root.xml' }) }
    );
    const body = await response.text();

    expect(mockGetSitemapIndexLinks).toHaveBeenCalledWith({
      merchant: { id: 'm1' },
    });
    expect(mockCreateSitemapIndexResponse).toHaveBeenCalledWith(
      [
        'https://ogabassey.com/sitemap/static.xml',
        'https://ogabassey.com/sitemap/products.xml',
      ],
      'm1'
    );
    expect(mockGetNamedSitemapEntries).not.toHaveBeenCalled();
    expect(body).toContain('https://ogabassey.com/sitemap/products.xml');
  });

  it('returns a 503 response when the storefront lookup is temporarily unavailable', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'unavailable',
    });
    const mockUnavailableResponse = new Response('Service Unavailable', {
      status: 503,
      headers: {
        'cache-control': 'no-store',
        'retry-after': '300',
      },
    });
    mockCreateSitemapUnavailableResponse.mockReturnValue(
      mockUnavailableResponse
    );

    const { GET } = await import('./route');
    const request = new Request(
      'https://ogabassey.com/ogabassey/sitemap/static.xml'
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: 'ogabassey', id: 'static' }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('300');
  });

  it('returns a 404 response when the storefront does not exist', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'not-found',
    });

    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'https://test-store.usebaci.com/test-store/sitemap/static.xml'
      ),
      {
        params: Promise.resolve({ slug: 'test-store', id: 'static' }),
      }
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mockCreateSitemapNotFoundResponse).toHaveBeenCalledOnce();
  });

  it('passes the Request object as the third argument to resolveStorefrontSitemapContext', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: { merchant: { id: 'm1' } },
    });
    mockGetNamedSitemapEntries.mockResolvedValue([]);

    const { GET } = await import('./route');
    const request = new Request(
      'https://ogabassey.com/ogabassey/sitemap/static.xml'
    );
    await GET(request, {
      params: Promise.resolve({ slug: 'ogabassey', id: 'static' }),
    });

    expect(mockResolveStorefrontSitemapContext).toHaveBeenCalledWith(
      expect.any(Headers),
      'ogabassey',
      request
    );
  });
});
