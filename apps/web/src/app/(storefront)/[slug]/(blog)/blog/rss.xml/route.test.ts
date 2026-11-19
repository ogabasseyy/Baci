import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHeaders = vi.fn();
const mockResolveStorefrontSitemapContext = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('../../../sitemap-data', () => ({
  resolveStorefrontSitemapContextResult: (...args: unknown[]) =>
    mockResolveStorefrontSitemapContext(...args),
}));

import { GET } from './route';

describe('GET /[slug]/blog/rss.xml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
  });

  it('temporarily redirects to canonical /blog/feed.xml when blog is enabled', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: {
        merchant: {
          slug: 'ogabassey',
          feature_settings: { blog_enabled: true },
        },
        storeUrl: 'https://ogabassey.com',
      },
    });

    const response = await GET(
      new Request('https://ogabassey.com/blog/rss.xml'),
      { params: Promise.resolve({ slug: 'ogabassey.com' }) }
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://ogabassey.com/blog/feed.xml'
    );
  });

  it('returns 404 when merchant context is missing', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'not-found',
    });

    const response = await GET(
      new Request('https://ogabassey.com/blog/rss.xml'),
      { params: Promise.resolve({ slug: 'ogabassey.com' }) }
    );

    expect(response.status).toBe(404);
  });

  it('returns 503 without redirecting when merchant lookup is unavailable', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'unavailable',
    });

    const response = await GET(
      new Request('https://ogabassey.com/blog/rss.xml'),
      { params: Promise.resolve({ slug: 'ogabassey.com' }) }
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
  });
});
