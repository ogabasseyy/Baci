import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookies = vi.fn();
const mockHeaders = vi.fn();
const mockCreateClient = vi.fn();
const mockSelect = vi.fn();
const mockNot = vi.fn();
const mockOrder = vi.fn();
const mockGetPlatformBlogSitemapPosts = vi.fn();

vi.mock('next/headers', () => ({
  cookies: () => mockCookies(),
  headers: () => mockHeaders(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock('@/lib/platform-blog', () => ({
  getPlatformBlogSitemapPosts: (...args: unknown[]) =>
    mockGetPlatformBlogSitemapPosts(...args),
}));

describe('root sitemap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockCookies.mockResolvedValue({});
    mockHeaders.mockResolvedValue(new Headers([['host', 'usebaci.com']]));

    mockOrder.mockResolvedValue({
      data: [
        {
          slug: 'ogabassey',
          updated_at: '2026-04-21T12:00:00.000Z',
        },
      ],
      error: null,
    });

    mockNot.mockReturnValue({
      order: mockOrder,
    });

    mockSelect.mockReturnValue({
      not: mockNot,
    });

    mockCreateClient.mockReturnValue({
      from: () => ({
        select: mockSelect,
      }),
    });

    mockGetPlatformBlogSitemapPosts.mockResolvedValue([
      {
        published_at: '2026-05-16T09:00:00.000Z',
        slug: 'launch-faster',
        updated_at: '2026-05-16T10:00:00.000Z',
      },
    ]);
  });

  it('includes crawlable pages plus real platform blog slugs', async () => {
    const { default: sitemap } = await import('./sitemap');

    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).toContain('https://usebaci.com/');
    expect(urls).toContain('https://usebaci.com/pricing');
    expect(urls).toContain('https://usebaci.com/features');
    expect(urls).toContain('https://usebaci.com/blog');
    expect(urls).toContain('https://usebaci.com/blog/launch-faster');

    expect(urls).not.toContain('https://usebaci.com/login');
    expect(urls).not.toContain('https://usebaci.com/onboarding');
    expect(urls).not.toContain('https://usebaci.com/dashboard');
    expect(mockGetPlatformBlogSitemapPosts).toHaveBeenCalled();
  });

  it('excludes legacy fake platform blog slug URLs', async () => {
    const { default: sitemap } = await import('./sitemap');

    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).not.toContain(
      'https://usebaci.com/blog/ai-revolutionizing-ecommerce'
    );
    expect(urls).not.toContain(
      'https://usebaci.com/blog/writing-product-descriptions'
    );
    expect(urls).not.toContain('https://usebaci.com/blog/introducing-baci-pro');
  });

  it('includes storefront discovery URLs for active merchants', async () => {
    const { default: sitemap } = await import('./sitemap');

    const result = await sitemap();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://usebaci.com/ogabassey',
          changeFrequency: 'daily',
          lastModified: new Date('2026-04-21T12:00:00.000Z'),
          priority: 0.6,
        }),
      ])
    );
  });

  it('falls back to static platform pages when dynamic lookups fail', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      mockOrder.mockResolvedValue({
        data: [],
        error: new Error('db failure'),
      });
      mockGetPlatformBlogSitemapPosts.mockRejectedValueOnce(
        new Error('blog failure')
      );

      const { default: sitemap } = await import('./sitemap');
      const result = await sitemap();
      const urls = result.map((entry) => entry.url);

      expect(urls).toContain('https://usebaci.com/');
      expect(urls).toContain('https://usebaci.com/pricing');
      expect(urls).toContain('https://usebaci.com/features');
      expect(urls).toContain('https://usebaci.com/blog');
      expect(urls).not.toContain('https://usebaci.com/ogabassey');
      expect(urls).not.toContain('https://usebaci.com/blog/launch-faster');
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
