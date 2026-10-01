import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsSitemapRouteContext } from './route';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';

let mockHeaders = new Map<string, string>();
let mockBlogPosts: Array<{
  slug: string;
  title: string | null;
  published_at: string | null;
  updated_at: string | null;
}> = [];
let mockBlogPostError: Error | null = null;

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => mockHeaders),
}));

const mockGetMerchantByIdentifier = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
}));

const mockLimit = vi.fn(() => ({
  data: mockBlogPosts,
  error: mockBlogPostError,
}));
const mockOrder = vi.fn(() => ({ limit: mockLimit }));
const mockGte = vi.fn(() => ({ order: mockOrder }));
const mockNot = vi.fn(() => ({ gte: mockGte }));
const mockEq = vi.fn(() => ({ eq: mockEq, not: mockNot }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

function createNewsSitemapRequest(host = 'ogabassey.com') {
  return new Request(`https://${host}/blog/news-sitemap.xml`, {
    headers: { host },
  });
}

function createNewsSitemapRouteContext(
  slug = 'ogabassey'
): NewsSitemapRouteContext {
  return {
    params: Promise.resolve({ slug }),
  };
}

describe('GET /blog/news-sitemap.xml', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T09:00:00.000Z'));
    mockHeaders = new Map([['host', 'ogabassey.com']]);
    mockBlogPosts = [];
    mockBlogPostError = null;
    mockGetMerchantByIdentifier.mockResolvedValue({
      business_name: 'Ogabassey Easybuy Gadgets',
      custom_domain: 'ogabassey.com',
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      feature_settings: { blog_enabled: true },
    });
  });

  it('returns a Google News sitemap for recent public blog posts', async () => {
    mockBlogPosts = [
      {
        slug: 'infinix-hot-70-nigeria-release',
        title: 'Infinix Hot 70 Nigeria Release: What Buyers Should Know',
        published_at: '2026-06-11T06:00:00.000Z',
        updated_at: '2026-06-11T07:00:00.000Z',
      },
      {
        slug: 'test-post-agent-integration-working',
        title: 'Test Post: Agent Integration Working',
        published_at: '2026-06-11T06:00:00.000Z',
        updated_at: '2026-06-11T07:00:00.000Z',
      },
    ];

    const { GET } = await import('./route');
    const response = await GET(
      createNewsSitemapRequest(),
      createNewsSitemapRouteContext()
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/xml; charset=utf-8'
    );
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=1800, stale-while-revalidate=1800'
    );
    expect(xml).toContain(
      'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"'
    );
    expect(xml).toContain(
      '<loc>https://ogabassey.com/blog/infinix-hot-70-nigeria-release</loc>'
    );
    expect(xml).toContain('<news:name>Ogabassey Easybuy Gadgets</news:name>');
    expect(xml).toContain('<news:language>en</news:language>');
    expect(xml).toContain(
      '<news:publication_date>2026-06-11T06:00:00.000Z</news:publication_date>'
    );
    expect(xml).not.toContain('test-post-agent-integration-working');
    expect(mockGte).toHaveBeenCalledWith(
      'published_at',
      '2026-06-09T10:05:00.000Z'
    );
    expect(mockOrder).toHaveBeenCalledWith('published_at', {
      ascending: false,
    });
    expect(mockLimit).toHaveBeenCalledWith(1000);
  });

  it('returns an empty sitemap when the blog feature is disabled', async () => {
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      business_name: 'Ogabassey Easybuy Gadgets',
      custom_domain: 'ogabassey.com',
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      feature_settings: { blog_enabled: false },
    });

    const { GET } = await import('./route');
    const response = await GET(
      createNewsSitemapRequest(),
      createNewsSitemapRouteContext()
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain('<urlset');
    expect(xml).not.toContain('<url>');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns no public URLs for an unpublished storefront', async () => {
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      business_name: 'Ogabassey Easybuy Gadgets',
      custom_domain: 'ogabassey.com',
      id: 'merchant-1',
      is_published: false,
      slug: 'ogabassey',
      feature_settings: { blog_enabled: true },
    });

    const { GET } = await import('./route');
    const response = await GET(
      createNewsSitemapRequest(),
      createNewsSitemapRouteContext()
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).not.toContain('<url>');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('escapes XML text from titles and publication names', async () => {
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      business_name: 'Ogabassey & Sons',
      custom_domain: 'ogabassey.com',
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      feature_settings: { blog_enabled: true },
    });
    mockBlogPosts = [
      {
        slug: 'buyers-guide',
        title: 'Phones < Tablets & "Deals"',
        published_at: '2026-06-11T06:00:00.000Z',
        updated_at: null,
      },
    ];

    const { GET } = await import('./route');
    const response = await GET(
      createNewsSitemapRequest(),
      createNewsSitemapRouteContext()
    );
    const xml = await response.text();

    expect(xml).toContain('<news:name>Ogabassey &amp; Sons</news:name>');
    expect(xml).toContain(
      '<news:title>Phones &lt; Tablets &amp; &quot;Deals&quot;</news:title>'
    );
  });

  it('returns a no-store 503 when the storefront context cannot be resolved', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue(null);

    const { GET } = await import('./route');
    const response = await GET(
      createNewsSitemapRequest('unknown.example.com'),
      createNewsSitemapRouteContext('unknown')
    );
    const xml = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('300');
    expect(xml).toContain('<urlset');
    expect(xml).not.toContain('<url>');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns an empty sitemap when there are no recent blog posts', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      createNewsSitemapRequest(),
      createNewsSitemapRouteContext()
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain('<urlset');
    expect(xml).not.toContain('<url>');
    expect(mockFrom).toHaveBeenCalledWith('blog_posts');
  });

  it('filters posts missing a usable title or publication date', async () => {
    mockBlogPosts = [
      {
        slug: 'missing-title',
        title: '   ',
        published_at: '2026-06-11T06:00:00.000Z',
        updated_at: null,
      },
      {
        slug: 'missing-date',
        title: 'Missing date should not appear',
        published_at: null,
        updated_at: null,
      },
    ];

    const { GET } = await import('./route');
    const response = await GET(
      createNewsSitemapRequest(),
      createNewsSitemapRouteContext()
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).not.toContain('missing-title');
    expect(xml).not.toContain('missing-date');
    expect(xml).not.toContain('<url>');
  });

  it('throws a controlled error when the blog post query fails', async () => {
    mockBlogPostError = new Error('db');

    const { GET } = await import('./route');

    await expect(
      GET(createNewsSitemapRequest(), createNewsSitemapRouteContext())
    ).rejects.toThrow('Failed to fetch blog posts for Google News sitemap');
  });

  it('uses the route slug to resolve root-domain path-mode sitemap requests', async () => {
    mockHeaders = new Map([['host', 'usebaci.com']]);
    mockBlogPosts = [
      {
        slug: 'path-mode-news',
        title: 'Path Mode News',
        published_at: '2026-06-11T06:00:00.000Z',
        updated_at: null,
      },
    ];

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://usebaci.com/ogabassey/blog/news-sitemap.xml', {
        headers: { host: 'usebaci.com' },
      }),
      createNewsSitemapRouteContext('ogabassey')
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey');
    expect(xml).toContain('<news:title>Path Mode News</news:title>');
  });
});
