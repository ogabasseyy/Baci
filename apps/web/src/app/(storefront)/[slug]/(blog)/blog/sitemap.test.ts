import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';

let mockHeaders = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => mockHeaders),
}));

const mockGetMerchantByIdentifier = vi.fn();
let mockBlogEnabled = true;

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
}));

interface BlogPostRow {
  slug: string;
  published_at: string;
  updated_at: string;
  featured_image_url: string | null;
  featured_image_variants?: Record<string, unknown> | null;
  title?: string | null;
  author_name?: string | null;
}

interface BlogPostsResponse {
  data: BlogPostRow[] | null;
  error: Error | null;
}

interface EqChain {
  eq: (key: string, value: string) => EqChain | BlogPostsResponse;
  not: (
    key: string,
    operator: string,
    value: null
  ) => EqChain | BlogPostsResponse;
}

const mockEq =
  vi.fn<(key: string, value: string) => EqChain | BlogPostsResponse>();
const mockNot =
  vi.fn<(key: string, operator: string, value: null) => BlogPostsResponse>();
mockEq.mockImplementation(
  (): EqChain => ({
    eq: mockEq,
    not: mockNot,
  })
);
const mockSelect = vi.fn((): EqChain => ({ eq: mockEq, not: mockNot }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('../../sitemap-data', () => ({
  resolveStorefrontSitemapContext: async (headersList: Headers) => {
    const identifier =
      headersList.get('x-custom-domain') ??
      headersList.get('host') ??
      headersList.get('x-merchant-slug') ??
      '';
    const merchant = await mockGetMerchantByIdentifier(identifier);
    if (!merchant) return null;

    const customDomain = merchant.custom_domain?.trim();
    const storeUrl =
      customDomain &&
      (headersList.get('x-custom-domain') === customDomain ||
        headersList.get('host') === customDomain)
        ? `https://${customDomain}`
        : `https://${merchant.slug}.usebaci.com`;

    return {
      merchant: {
        ...merchant,
        is_published: merchant.is_published ?? true,
        feature_settings: { blog_enabled: mockBlogEnabled },
      },
      storeUrl,
      supabase: { from: mockFrom },
    };
  },
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

let sitemap: typeof import('./sitemap').default;

describe('blog sitemap', () => {
  beforeAll(async () => {
    ({ default: sitemap } = await import('./sitemap'));
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders = new Map();
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    mockBlogEnabled = true;
    mockEq.mockImplementation(() => ({ eq: mockEq, not: mockNot }));
    mockNot.mockReset();
  });

  it('uses the merchant custom domain for blog sitemap entries', async () => {
    mockHeaders = new Map([['x-custom-domain', 'ogabassey.com']]);
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockEq.mockImplementation((...args: unknown[]) => {
      const [key, value] = args as [string, string];
      if (key === 'status' && value === 'published') {
        return { eq: mockEq, not: mockNot };
      }

      return { eq: mockEq, not: mockNot };
    });
    mockNot.mockImplementation((...args: unknown[]) => {
      const [key, operator, value] = args as [string, string, null];
      if (key === 'published_at' && operator === 'is' && value === null) {
        return {
          data: [
            {
              slug: 'factory-unlocked-iphones-explained',
              title: 'Factory Unlocked iPhones Explained',
              published_at: '2026-03-01T00:00:00Z',
              updated_at: '2026-03-02T00:00:00Z',
              featured_image_url: null,
            },
          ],
          error: null,
        };
      }

      return { data: [], error: null };
    });

    const result = await sitemap();

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(result[0].url).toBe('https://ogabassey.com/blog');
    expect((result[0].lastModified as Date).toISOString()).toBe(
      '2026-03-02T00:00:00.000Z'
    );
    expect(result[1].url).toBe(
      'https://ogabassey.com/blog/factory-unlocked-iphones-explained'
    );
    expect(mockNot).toHaveBeenCalledWith('published_at', 'is', null);
  });

  it('falls back to the host header for custom domains when proxy headers are absent', async () => {
    mockHeaders = new Map([['host', 'ogabassey.com']]);
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockEq.mockImplementation((...args: unknown[]) => {
      const [key, value] = args as [string, string];
      if (key === 'status' && value === 'published') {
        return { eq: mockEq, not: mockNot };
      }

      return { eq: mockEq, not: mockNot };
    });
    mockNot.mockReturnValue({ data: [], error: null });

    const result = await sitemap();

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(result[0].url).toBe('https://ogabassey.com/blog');
  });

  it('returns an empty sitemap when the merchant is not found', async () => {
    mockHeaders = new Map([['host', 'missing.example']]);
    mockGetMerchantByIdentifier.mockResolvedValue(null);

    await expect(sitemap()).resolves.toEqual([]);
  });

  it('returns an empty sitemap when blog_enabled is false', async () => {
    mockHeaders = new Map([['host', 'ogabassey.com']]);
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockBlogEnabled = false;

    await expect(sitemap()).resolves.toEqual([]);
  });

  it('propagates blog post query errors', async () => {
    mockHeaders = new Map([['host', 'ogabassey.com']]);
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockEq.mockImplementation((...args: unknown[]) => {
      const [key, value] = args as [string, string];
      if (key === 'status' && value === 'published') {
        return { eq: mockEq, not: mockNot };
      }

      return { eq: mockEq, not: mockNot };
    });
    mockNot.mockReturnValue({ data: null, error: new Error('db') });

    await expect(sitemap()).rejects.toThrow(
      'Failed to fetch blog posts for sitemap'
    );
  });

  it('uses Discover image variants and excludes test posts from sitemap entries', async () => {
    mockHeaders = new Map([['host', 'ogabassey.com']]);
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockEq.mockImplementation(() => ({ eq: mockEq, not: mockNot }));
    mockNot.mockReturnValue({
      data: [
        {
          slug: 'android-17-buying-guide',
          title: 'Android 17 Buying Guide',
          published_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-02T00:00:00Z',
          featured_image_url: 'https://cdn.example.com/original.jpg',
          featured_image_variants: {
            landscape_16x9: 'https://cdn.example.com/landscape.jpg',
            standard_4x3: 'https://cdn.example.com/standard.jpg',
            square_1x1: 'https://cdn.example.com/square.jpg',
          },
        },
        {
          slug: 'test-post-agent-integration-working',
          title: 'Test Post: Agent Integration Working',
          published_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-02T00:00:00Z',
          featured_image_url: 'https://cdn.example.com/test.jpg',
        },
      ],
      error: null,
    });

    const result = await sitemap();

    // blog index + 1 real post (test post excluded); author hubs append after.
    const postEntries = result.filter(
      (e) =>
        e.url.startsWith('https://ogabassey.com/blog/') &&
        !e.url.startsWith('https://ogabassey.com/blog/author/')
    );
    expect(postEntries).toHaveLength(1);
    expect(
      result.some((e) => e.url.includes('test-post-agent-integration-working'))
    ).toBe(false);
    expect(result[1]).toEqual(
      expect.objectContaining({
        url: 'https://ogabassey.com/blog/android-17-buying-guide',
        images: [
          'https://cdn.example.com/landscape.jpg',
          'https://cdn.example.com/standard.jpg',
          'https://cdn.example.com/square.jpg',
        ],
      })
    );
  });

  it('lists author hubs with published posts and content-derived lastmod', async () => {
    mockHeaders = new Map([['x-custom-domain', 'ogabassey.com']]);
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockEq.mockImplementation(() => ({ eq: mockEq, not: mockNot }));
    mockNot.mockReturnValue({
      data: [
        {
          slug: 'bassey-old',
          title: 'Bassey Guide One',
          author_name: 'Bassey John',
          published_at: '2026-04-01T00:00:00Z',
          updated_at: '2026-04-02T00:00:00Z',
          featured_image_url: null,
        },
        {
          slug: 'bassey-new',
          title: 'Bassey Guide Two',
          author_name: 'Bassey John',
          published_at: '2026-05-09T00:00:00Z',
          updated_at: '2026-05-10T00:00:00Z',
          featured_image_url: null,
        },
        {
          slug: 'bolakale-post',
          title: 'Bolakale Guide',
          author_name: 'Bolakale',
          published_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-03T00:00:00Z',
          featured_image_url: null,
        },
      ],
      error: null,
    });

    const result = await sitemap();

    const bassey = result.find(
      (e) => e.url === 'https://ogabassey.com/blog/author/bassey-john'
    );
    const bolakale = result.find(
      (e) => e.url === 'https://ogabassey.com/blog/author/bolakale'
    );
    expect(bassey).toBeDefined();
    expect(bolakale).toBeDefined();
    // lastmod = the author's most recent post (Bassey John -> 2026-05-10)
    expect((bassey?.lastModified as Date).toISOString()).toBe(
      '2026-05-10T00:00:00.000Z'
    );
  });

  it('ignores malformed timestamps instead of emitting an invalid sitemap date', async () => {
    mockHeaders = new Map([['x-custom-domain', 'ogabassey.com']]);
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockEq.mockImplementation(() => ({ eq: mockEq, not: mockNot }));
    mockNot.mockReturnValue({
      data: [
        {
          slug: 'bassey-valid',
          title: 'Bassey Valid Guide',
          author_name: 'Bassey John',
          published_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-02T00:00:00Z',
          featured_image_url: null,
        },
        {
          slug: 'bassey-invalid-date',
          title: 'Bassey Invalid Date Guide',
          author_name: 'Bassey John',
          published_at: '2026-05-03T00:00:00Z',
          updated_at: 'not-a-date',
          featured_image_url: null,
        },
      ],
      error: null,
    });

    const result = await sitemap();
    const blog = result.find(
      (entry) => entry.url === 'https://ogabassey.com/blog'
    );
    const author = result.find(
      (entry) => entry.url === 'https://ogabassey.com/blog/author/bassey-john'
    );

    expect((blog?.lastModified as Date).toISOString()).toBe(
      '2026-05-03T00:00:00.000Z'
    );
    expect((author?.lastModified as Date).toISOString()).toBe(
      '2026-05-03T00:00:00.000Z'
    );
  });

  it('omits author hubs for authors with no published posts', async () => {
    mockHeaders = new Map([['x-custom-domain', 'ogabassey.com']]);
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockEq.mockImplementation(() => ({ eq: mockEq, not: mockNot }));
    // Only Bassey John has a published post; Bolakale has none.
    mockNot.mockReturnValue({
      data: [
        {
          slug: 'bassey-post',
          title: 'Bassey Guide',
          author_name: 'Bassey John',
          published_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-02T00:00:00Z',
          featured_image_url: null,
        },
      ],
      error: null,
    });

    const result = await sitemap();

    expect(
      result.some(
        (e) => e.url === 'https://ogabassey.com/blog/author/bassey-john'
      )
    ).toBe(true);
    expect(
      result.some((e) => e.url === 'https://ogabassey.com/blog/author/bolakale')
    ).toBe(false);
  });

  it('omits author hub pages for storefronts without author profiles', async () => {
    mockHeaders = new Map([['x-custom-domain', 'other-store.com']]);
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-2',
      slug: 'other-store',
      custom_domain: 'other-store.com',
    });
    mockEq.mockImplementation(() => ({ eq: mockEq, not: mockNot }));
    mockNot.mockReturnValue({
      data: [
        {
          slug: 'bassey-post',
          title: 'Bassey Guide',
          author_name: 'Bassey John',
          published_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-02T00:00:00Z',
          featured_image_url: null,
        },
      ],
      error: null,
    });

    const result = await sitemap();

    expect(result.some((e) => e.url.includes('/blog/author/'))).toBe(false);
  });
});
