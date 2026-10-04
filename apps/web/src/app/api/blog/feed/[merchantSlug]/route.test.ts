import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const { mockFeedAddItem, mockFeedConstructor, mockFrom, mockUnstableCache } =
  vi.hoisted(() => ({
    mockFeedAddItem: vi.fn(),
    mockFeedConstructor: vi.fn(),
    mockFrom: vi.fn(),
    mockUnstableCache: vi.fn(),
  }));

type QueryResult<T> = { data: T | null; error: { message: string } | null };
type MerchantRow = {
  id: string;
  slug: string;
  business_name: string;
  site_description: string | null;
  logo_url: string | null;
  domains: Array<{
    domain: string;
    is_primary: boolean;
    status: string;
  }> | null;
};
type FeedPostRow = {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  featured_image_url: string | null;
  featured_image_variants?: Record<string, unknown> | null;
  category: string | null;
  author_name: string | null;
  published_at: string | null;
  updated_at: string | null;
};

const tableQueues = new Map<string, unknown[]>();

function enqueueTable(table: string, builder: unknown) {
  tableQueues.set(table, [...(tableQueues.get(table) ?? []), builder]);
}

function createMerchantQuery(result: QueryResult<MerchantRow | null>) {
  const builder = {
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(result),
  };
  return builder;
}

function createDomainQuery(
  result: QueryResult<{ merchant_id: string } | null>
) {
  const builder = {
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(() => builder),
  };
  return builder;
}

function createPostQuery(result: QueryResult<FeedPostRow[]>) {
  const builder = {
    eq: vi.fn(() => builder),
    not: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn().mockResolvedValue(result),
    select: vi.fn(() => builder),
  };
  return builder;
}

const merchant: MerchantRow = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  site_description: 'Gadgets in Nigeria',
  logo_url: null,
  domains: [],
};

const merchantWithCustomDomain: MerchantRow = {
  ...merchant,
  domains: [
    {
      domain: 'shop.example.com',
      is_primary: true,
      status: 'active',
    },
  ],
};

function enqueueSlugFeedScenario(
  options: { cachedMerchant?: MerchantRow; posts?: FeedPostRow[] } = {}
) {
  enqueueTable(
    'merchants',
    createMerchantQuery({ data: merchant, error: null })
  );
  enqueueTable(
    'merchants',
    createMerchantQuery({
      data: options.cachedMerchant ?? merchant,
      error: null,
    })
  );
  enqueueTable(
    'blog_posts',
    createPostQuery({ data: options.posts ?? [], error: null })
  );
}

function enqueueCustomDomainFeedScenario(posts: FeedPostRow[] = []) {
  enqueueTable('merchants', createMerchantQuery({ data: null, error: null }));
  enqueueTable(
    'domains',
    createDomainQuery({ data: { merchant_id: 'merchant-1' }, error: null })
  );
  enqueueTable(
    'merchants',
    createMerchantQuery({ data: merchantWithCustomDomain, error: null })
  );
  enqueueTable(
    'merchants',
    createMerchantQuery({ data: merchantWithCustomDomain, error: null })
  );
  enqueueTable('blog_posts', createPostQuery({ data: posts, error: null }));
}

function buildJunkFeedBatch(count = 50): FeedPostRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `junk-${index + 1}`,
    title: 'Test Post: Agent Integration Working',
    slug: `test-post-agent-integration-working-${index + 1}`,
    content: '<p>junk</p>',
    excerpt: 'junk',
    featured_image_url: null,
    category: null,
    author_name: 'Ogabassey',
    published_at: '2026-05-01T10:00:00.000Z',
    updated_at: null,
  }));
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

const mockGetCurrentSlugForAlias = vi.fn();
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: (...args: unknown[]) =>
    mockGetCurrentSlugForAlias(...args),
}));

vi.mock('feed', () => ({
  Feed: class MockFeed {
    constructor(options: unknown) {
      mockFeedConstructor(options);
    }

    addItem(item: unknown) {
      mockFeedAddItem(item);
    }

    rss2() {
      return JSON.stringify({
        options: mockFeedConstructor.mock.calls.at(-1)?.[0],
        items: mockFeedAddItem.mock.calls.map((call) => call[0]),
      });
    }
  },
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown, keyParts: string[], options: unknown) => {
    mockUnstableCache(fn, keyParts, options);
    return (...args: unknown[]) =>
      (fn as (...args: unknown[]) => unknown)(...args);
  },
}));

vi.mock('@/env', () => ({
  getAppUrl: () => 'https://usebaci.com',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseUrl: () => 'https://test.supabase.co',
}));

const { GET } = await import('./route');

describe('GET /api/blog/feed/[merchantSlug]', () => {
  beforeEach(() => {
    mockFeedAddItem.mockClear();
    mockFeedConstructor.mockClear();
    mockFrom.mockReset();
    tableQueues.clear();
    // Default: the identifier is not a retired alias.
    mockGetCurrentSlugForAlias.mockReset().mockResolvedValue(null);
    mockFrom.mockImplementation((table: string) => {
      const builder = tableQueues.get(table)?.shift();
      if (!builder) {
        throw new Error(`Unexpected table query: ${table}`);
      }
      return builder;
    });
  });

  it('attaches the rss cache tag and excludes feed posts without a published_at timestamp', async () => {
    enqueueSlugFeedScenario();

    const response = await GET(new NextRequest('http://localhost/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const postQuery = mockFrom.mock.results[2]?.value as ReturnType<
      typeof createPostQuery
    >;
    expect(postQuery.eq).toHaveBeenCalledWith('status', 'published');
    expect(postQuery.not).toHaveBeenCalledWith('published_at', 'is', null);
    expect(postQuery.order).toHaveBeenNthCalledWith(1, 'published_at', {
      ascending: false,
    });
    expect(postQuery.order).toHaveBeenNthCalledWith(2, 'id', {
      ascending: false,
    });
    expect(mockUnstableCache.mock.calls.at(-1)).toEqual([
      expect.any(Function),
      ['blog-rss-feed'],
      expect.objectContaining({
        tags: ['blog-posts', 'blog-rss-feed'],
      }),
    ]);
  });

  it('removes XML 1.0 control characters from feed metadata and article fields', async () => {
    const unsafeMerchant = {
      ...merchant,
      business_name: 'Oga\u001ABassey',
      site_description: 'Phones\u000B and laptops',
    };
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: unsafeMerchant, error: null })
    );
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: unsafeMerchant, error: null })
    );
    enqueueTable(
      'blog_posts',
      createPostQuery({
        data: [
          {
            id: 'post-1',
            slug: 'public-feed-post',
            title: 'Phone\u001A guide',
            content: '<p>₦61,817,004.65\u001A📱</p>',
            excerpt: 'Price\u000B update',
            featured_image_url: null,
            author_name: 'Author\u0000 Name',
            category: null,
            published_at: '2026-05-02T10:00:00.000Z',
            updated_at: null,
          },
        ],
        error: null,
      })
    );

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      options: { title: string; description: string };
      items: Array<{
        title: string;
        description: string;
        content: string;
        author: Array<{ name: string }>;
      }>;
    };
    expect(payload.options.title).toBe('OgaBassey Blog');
    expect(payload.options.description).toBe('Phones and laptops');
    expect(payload.items[0]).toMatchObject({
      title: 'Phone guide',
      description: 'Price update',
      content: '<p>₦61,817,004.65📱</p>',
      author: [{ name: 'Author Name' }],
    });
  });

  it('falls back to the merchant name when a post author is null', async () => {
    enqueueSlugFeedScenario({
      posts: [
        {
          id: 'post-1',
          slug: 'public-feed-post',
          title: 'Phone guide',
          content: '<p>Body</p>',
          excerpt: 'Excerpt',
          featured_image_url: null,
          category: null,
          author_name: null,
          published_at: '2026-05-02T10:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      items: Array<{ author: Array<{ name: string }> }>;
    };
    expect(payload.items[0]?.author).toEqual([
      { name: 'Ogabassey', link: 'https://usebaci.com/ogabassey' },
    ]);
  });

  it('excludes posts whose blocked title prefix is split by a control character', async () => {
    enqueueSlugFeedScenario({
      posts: [
        {
          id: 'post-1',
          slug: 'sneaky-post',
          title: 'Te\u001ast post: sneak',
          content: '<p>Body</p>',
          excerpt: 'Excerpt',
          featured_image_url: null,
          category: null,
          author_name: 'Ogabassey',
          published_at: '2026-05-02T10:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      items: unknown[];
    };
    expect(payload.items).toHaveLength(0);
  });

  it('percent-encodes control characters in post slugs instead of deleting them', async () => {
    enqueueSlugFeedScenario({
      posts: [
        {
          id: 'post-1',
          slug: 'launch\u001a-faster',
          title: 'Launch guide',
          content: '<p>Body</p>',
          excerpt: 'Excerpt',
          featured_image_url: null,
          category: null,
          author_name: 'Ogabassey',
          published_at: '2026-05-02T10:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      items: Array<{ id: string; link: string }>;
    };
    expect(payload.items[0]).toMatchObject({
      id: 'https://usebaci.com/ogabassey/blog/launch%1A-faster',
      link: 'https://usebaci.com/ogabassey/blog/launch%1A-faster',
    });
  });

  it('excludes posts whose blocked slug part is split by a control character', async () => {
    enqueueSlugFeedScenario({
      posts: [
        {
          id: 'post-1',
          slug: 'agent-\u001aintegration-working',
          title: 'Launch guide',
          content: '<p>Body</p>',
          excerpt: 'Excerpt',
          featured_image_url: null,
          category: null,
          author_name: 'Ogabassey',
          published_at: '2026-05-02T10:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      items: unknown[];
    };
    expect(payload.items).toHaveLength(0);
  });

  it('omits a blocked category whose value is split by a control character', async () => {
    enqueueSlugFeedScenario({
      posts: [
        {
          id: 'post-1',
          slug: 'public-feed-post',
          title: 'Launch guide',
          content: '<p>Body</p>',
          excerpt: 'Excerpt',
          featured_image_url: null,
          category: 'te\u001ast',
          author_name: 'Ogabassey',
          published_at: '2026-05-02T10:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      items: Array<{ category?: Array<{ name: string }> }>;
    };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.category).toBeUndefined();
  });

  it('truncates excerpts by code points without splitting surrogate pairs', async () => {
    enqueueSlugFeedScenario({
      posts: [
        {
          id: 'post-1',
          slug: 'public-feed-post',
          title: 'Launch guide',
          content: `<p>${'a'.repeat(299)}📱${'b'.repeat(10)}</p>`,
          excerpt: null,
          featured_image_url: null,
          category: null,
          author_name: 'Ogabassey',
          published_at: '2026-05-02T10:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      items: Array<{ description: string }>;
    };
    expect(payload.items[0]?.description).toBe(`${'a'.repeat(299)}📱`);
  });

  it('omits the merchant logo when XML stripping would rewrite its URL', async () => {
    const unsafeMerchant = {
      ...merchant,
      logo_url: 'https://usebaci.com/logo\u0008.png',
    };
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: unsafeMerchant, error: null })
    );
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: unsafeMerchant, error: null })
    );
    enqueueTable('blog_posts', createPostQuery({ data: [], error: null }));

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      options: { image?: string };
    };
    expect(payload.options.image).toBeUndefined();
  });

  it('percent-encodes control characters in channel URLs instead of deleting them', async () => {
    const unsafeMerchant = {
      ...merchant,
      slug: 'ogabassey\u001a',
    };
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: unsafeMerchant, error: null })
    );
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: unsafeMerchant, error: null })
    );
    enqueueTable('blog_posts', createPostQuery({ data: [], error: null }));

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      options: { id: string; link: string };
    };
    expect(payload.options.id).toBe('https://usebaci.com/ogabassey%1A/blog');
    expect(payload.options.link).toBe('https://usebaci.com/ogabassey%1A/blog');
  });

  it('over-fetches additional ranges when early batches are fully filtered', async () => {
    const junkBatch = buildJunkFeedBatch();
    const publicPost = {
      id: 'public-post-1',
      title: 'Public Feed Post',
      slug: 'public-feed-post',
      content: '<p>public</p>',
      excerpt: 'public',
      featured_image_url: null,
      category: null,
      author_name: 'Ogabassey',
      published_at: '2026-05-02T10:00:00.000Z',
      updated_at: null,
    };

    enqueueTable(
      'merchants',
      createMerchantQuery({ data: merchant, error: null })
    );
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: merchant, error: null })
    );
    enqueueTable(
      'blog_posts',
      createPostQuery({ data: junkBatch, error: null })
    );
    enqueueTable(
      'blog_posts',
      createPostQuery({ data: [publicPost], error: null })
    );

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    expect(mockFeedAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Public Feed Post' })
    );
    const firstPostQuery = mockFrom.mock.results[2]?.value as ReturnType<
      typeof createPostQuery
    >;
    const secondPostQuery = mockFrom.mock.results[3]?.value as ReturnType<
      typeof createPostQuery
    >;
    expect(firstPostQuery.range).toHaveBeenCalledWith(0, 49);
    expect(secondPostQuery.range).toHaveBeenCalledWith(50, 99);
  });

  it('stops over-fetching after a bounded number of filtered batches', async () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: merchant, error: null })
    );
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: merchant, error: null })
    );

    for (let index = 0; index < 6; index += 1) {
      enqueueTable(
        'blog_posts',
        createPostQuery({ data: buildJunkFeedBatch(), error: null })
      );
    }

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    expect(mockFeedAddItem).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledTimes(8);
    expect(consoleWarn).toHaveBeenCalledWith(
      'Stopped blog feed fetch after max iterations',
      expect.objectContaining({
        merchantId: 'merchant-1',
        fetchIterations: 6,
        collectedPosts: 0,
      })
    );
    consoleWarn.mockRestore();
  });

  it('resolves custom-domain identifiers to the canonical merchant feed', async () => {
    enqueueCustomDomainFeedScenario();

    const response = await GET(
      new NextRequest('https://shop.example.com/feed'),
      {
        params: Promise.resolve({ merchantSlug: 'shop.example.com' }),
      }
    );

    expect(response.status).toBe(200);
    expect(mockFeedConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        feedLinks: {
          rss2: 'https://shop.example.com/api/blog/feed/ogabassey',
        },
      })
    );
  });

  it('builds path-mode feed URLs from the storefront origin root', async () => {
    enqueueSlugFeedScenario();

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    expect(mockFeedConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        feedLinks: {
          rss2: 'https://usebaci.com/api/blog/feed/ogabassey',
        },
      })
    );
  });

  it('returns 404 when neither slug nor custom domain resolves to a merchant', async () => {
    enqueueTable('merchants', createMerchantQuery({ data: null, error: null }));
    enqueueTable('domains', createDomainQuery({ data: null, error: null }));

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'missing-store' }),
    });

    expect(response.status).toBe(404);
  });

  it('resolves a RETIRED slug in the feed PATH via the alias table', async () => {
    // /api/blog/feed/<oldSlug> after a rename: the slug lives in the path (the proxy
    // can't rewrite it), so slug + custom-domain both miss, the alias resolves the
    // current slug, and the retry lookup returns the merchant instead of 404ing.
    enqueueTable('merchants', createMerchantQuery({ data: null, error: null })); // slug miss
    enqueueTable('domains', createDomainQuery({ data: null, error: null })); // domain miss
    mockGetCurrentSlugForAlias.mockResolvedValue('ogabassey'); // alias -> current
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: merchant, error: null })
    ); // alias slug hit
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: merchant, error: null })
    ); // cached by-id lookup
    enqueueTable('blog_posts', createPostQuery({ data: [], error: null }));

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'oldslug' }),
    });

    expect(response.status).toBe(200);
    expect(mockGetCurrentSlugForAlias).toHaveBeenCalledWith('oldslug');
  });

  it('returns 500 when loading published feed posts fails', async () => {
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: merchant, error: null })
    );
    enqueueTable(
      'merchants',
      createMerchantQuery({ data: merchant, error: null })
    );
    enqueueTable(
      'blog_posts',
      createPostQuery({ data: null, error: { message: 'boom' } })
    );

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(500);
  });

  it('omits feed updated metadata when there are no valid published post dates', async () => {
    enqueueSlugFeedScenario({ posts: [] });

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    const lastCall = mockFeedConstructor.mock.calls.at(-1)?.[0] as
      | { updated?: Date }
      | undefined;
    expect(lastCall).toBeDefined();
    expect(lastCall).not.toEqual(
      expect.objectContaining({ updated: expect.any(Date) })
    );
    expect(Object.hasOwn(lastCall ?? {}, 'updated')).toBe(false);
  });

  it('skips malformed post dates instead of failing the feed render', async () => {
    enqueueSlugFeedScenario({
      posts: [
        {
          id: 'bad-date',
          title: 'Bad Date',
          slug: 'bad-date',
          content: '<p>Bad date</p>',
          excerpt: 'Bad date',
          featured_image_url: null,
          category: null,
          author_name: 'Ogabassey',
          published_at: 'not-a-date',
          updated_at: null,
        },
        {
          id: 'good-date',
          title: 'Good Date',
          slug: 'good-date',
          content: '<p>Good date</p>',
          excerpt: 'Good date',
          featured_image_url: null,
          category: null,
          author_name: 'Ogabassey',
          published_at: '2026-05-01T10:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    expect(mockFeedAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Good Date' })
    );
    expect(mockFeedAddItem).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Bad Date' })
    );
  });

  it('uses public-quality posts and the first Discover image variant in feed items', async () => {
    enqueueSlugFeedScenario({
      posts: [
        {
          id: 'good-post',
          title: 'Best Android Phones',
          slug: 'best-android-phones',
          content: '<p>Useful guide</p>',
          excerpt: 'Useful guide',
          featured_image_url: 'https://cdn.example.com/original.jpg',
          featured_image_variants: {
            landscape_16x9: 'https://cdn.example.com/landscape.jpg',
            standard_4x3: 'https://cdn.example.com/standard.jpg',
          },
          category: 'Smartphones',
          author_name: 'Ogabassey',
          published_at: '2026-05-01T10:00:00.000Z',
          updated_at: null,
        },
        {
          id: 'test-post',
          title: 'Test Post: Agent Integration Working',
          slug: 'test-post-agent-integration-working',
          content: '<p>Test</p>',
          excerpt: 'Test',
          featured_image_url: 'https://cdn.example.com/test.jpg',
          category: 'gcrblw',
          author_name: 'Ogabassey',
          published_at: '2026-05-01T10:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    const response = await GET(new NextRequest('https://usebaci.com/feed'), {
      params: Promise.resolve({ merchantSlug: 'ogabassey' }),
    });

    expect(response.status).toBe(200);
    expect(mockFeedAddItem).toHaveBeenCalledOnce();
    expect(mockFeedAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Best Android Phones',
        image: 'https://cdn.example.com/landscape.jpg',
        category: [{ name: 'Smartphones' }],
      })
    );
  });
});
