import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookies = vi.fn();
const mockHeaders = vi.fn();
const mockCreateClient = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
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

describe('root sitemap domain filtering and timestamps', () => {
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

    mockEq.mockReturnValue({
      not: mockNot,
    });

    mockSelect.mockReturnValue({
      eq: mockEq,
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

  it('excludes merchants with active custom or purchased domains and includes merchants without custom domains', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          slug: 'custom-domain-store',
          updated_at: '2026-04-21T12:00:00.000Z',
          domains: [
            {
              domain: 'custom.example.com',
              status: 'active',
              domain_type: 'custom',
              is_primary: true,
            },
          ],
        },
        {
          slug: 'purchased-domain-store',
          updated_at: '2026-04-21T12:00:00.000Z',
          domains: [
            {
              domain: 'purchased.example.com',
              status: 'active',
              domain_type: 'purchased',
              is_primary: false,
            },
          ],
        },
        {
          slug: 'pending-domain-store',
          updated_at: '2026-04-21T12:00:00.000Z',
          domains: [
            {
              domain: 'pending.example.com',
              status: 'pending',
              domain_type: 'custom',
              is_primary: true,
            },
          ],
        },
        {
          slug: 'empty-domain-store',
          updated_at: '2026-04-21T12:00:00.000Z',
          domains: [
            {
              domain: '   ',
              status: 'active',
              domain_type: 'custom',
              is_primary: true,
            },
          ],
        },
        {
          slug: 'subdomain-type-store',
          updated_at: '2026-04-21T12:00:00.000Z',
          domains: [
            {
              domain: 'subdomain.usebaci.com',
              status: 'active',
              domain_type: 'subdomain',
              is_primary: true,
            },
          ],
        },
        {
          slug: 'no-domain-store',
          updated_at: '2026-04-21T12:00:00.000Z',
          domains: [],
        },
        {
          slug: 'single-obj-active-store',
          updated_at: '2026-04-21T12:00:00.000Z',
          domains: {
            domain: 'single.example.com',
            status: 'active',
            domain_type: 'custom',
            is_primary: true,
          },
        },
        {
          slug: 'mixed-case-custom-store',
          updated_at: '2026-04-21T12:00:00.000Z',
          domains: [
            {
              domain: 'case1.example.com',
              status: 'Active',
              domain_type: 'Custom',
              is_primary: true,
            },
          ],
        },
        {
          slug: 'mixed-case-purchased-store',
          updated_at: '2026-04-21T12:00:00.000Z',
          domains: [
            {
              domain: 'case2.example.com',
              status: 'ACTIVE',
              domain_type: 'PURCHASED',
              is_primary: false,
            },
          ],
        },
      ],
      error: null,
    });

    const { default: sitemap } = await import('./sitemap');
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).not.toContain('https://usebaci.com/custom-domain-store');
    expect(urls).not.toContain('https://usebaci.com/purchased-domain-store');
    expect(urls).not.toContain('https://usebaci.com/single-obj-active-store');
    expect(urls).not.toContain('https://usebaci.com/mixed-case-custom-store');
    expect(urls).not.toContain(
      'https://usebaci.com/mixed-case-purchased-store'
    );
    expect(urls).toContain('https://usebaci.com/pending-domain-store');
    expect(urls).toContain('https://usebaci.com/empty-domain-store');
    expect(urls).toContain('https://usebaci.com/subdomain-type-store');
    expect(urls).toContain('https://usebaci.com/no-domain-store');
  });

  it('does not fabricate lastModified timestamps on static pages or untimestamped records', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          slug: 'untimestamped-store',
          updated_at: null,
        },
      ],
      error: null,
    });
    mockGetPlatformBlogSitemapPosts.mockResolvedValueOnce([
      {
        published_at: null,
        slug: 'untimestamped-post',
        updated_at: null,
      },
    ]);

    const { default: sitemap } = await import('./sitemap');
    const result = await sitemap();

    const homeEntry = result.find(
      (entry) => entry.url === 'https://usebaci.com/'
    );
    const blogEntry = result.find(
      (entry) => entry.url === 'https://usebaci.com/blog/untimestamped-post'
    );
    const storeEntry = result.find(
      (entry) => entry.url === 'https://usebaci.com/untimestamped-store'
    );

    expect(homeEntry?.lastModified).toBeUndefined();
    expect(blogEntry?.lastModified).toBeUndefined();
    expect(storeEntry?.lastModified).toBeUndefined();
  });

  it('omits invalid lastModified timestamps for malformed merchant and blog dates', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          slug: 'malformed-store',
          updated_at: 'not-a-valid-date',
        },
      ],
      error: null,
    });
    mockGetPlatformBlogSitemapPosts.mockResolvedValueOnce([
      {
        published_at: '2026-05-16T09:00:00.000Z',
        slug: 'fallback-post',
        updated_at: 'malformed-updated-at',
      },
      {
        published_at: 'malformed-published-at',
        slug: 'invalid-post-both',
        updated_at: 'malformed-updated-at',
      },
      {
        published_at: null,
        slug: 'invalid-post-updated-only',
        updated_at: 'malformed-updated-at',
      },
      {
        published_at: 'malformed-published-at',
        slug: 'invalid-post-published-only',
        updated_at: null,
      },
    ]);

    const { default: sitemap } = await import('./sitemap');
    const result = await sitemap();

    const storeEntry = result.find(
      (entry) => entry.url === 'https://usebaci.com/malformed-store'
    );
    const fallbackPostEntry = result.find(
      (entry) => entry.url === 'https://usebaci.com/blog/fallback-post'
    );
    const invalidPostBothEntry = result.find(
      (entry) => entry.url === 'https://usebaci.com/blog/invalid-post-both'
    );
    const invalidPostUpdatedOnlyEntry = result.find(
      (entry) =>
        entry.url === 'https://usebaci.com/blog/invalid-post-updated-only'
    );
    const invalidPostPublishedOnlyEntry = result.find(
      (entry) =>
        entry.url === 'https://usebaci.com/blog/invalid-post-published-only'
    );

    expect(storeEntry?.lastModified).toBeUndefined();
    expect(fallbackPostEntry?.lastModified).toEqual(
      new Date('2026-05-16T09:00:00.000Z')
    );
    expect(invalidPostBothEntry?.lastModified).toBeUndefined();
    expect(invalidPostUpdatedOnlyEntry?.lastModified).toBeUndefined();
    expect(invalidPostPublishedOnlyEntry?.lastModified).toBeUndefined();
  });
});
