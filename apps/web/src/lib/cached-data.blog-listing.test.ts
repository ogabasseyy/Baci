import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'test-service-role-key'),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('react', () => ({ cache: vi.fn((fn) => fn) }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { cacheLife } from 'next/cache';
import {
  getCachedBlogAuthor,
  getCachedBlogListing,
  getCachedFeatureSettings,
} from '@/lib/cached-data';
import {
  buildBlogMerchantRow,
  createBlogMerchantRpcMock,
} from '@/lib/cached-data.test-utils';

function createQueryBuilder({
  queryResult = { data: [], count: 0, error: null },
  singleResult = { data: null, error: null },
}: {
  queryResult?: { count?: number | null; data: unknown; error: unknown };
  singleResult?: { data: unknown; error: unknown };
}) {
  const builder = {
    eq: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(singleResult),
    neq: vi.fn(() => builder),
    not: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(singleResult),
    textSearch: vi.fn(() => builder),
  };

  Object.defineProperty(builder, 'then', {
    value: (
      resolve: (value: {
        count?: number | null;
        data: unknown;
        error: unknown;
      }) => void,
      reject?: (reason: unknown) => void
    ) => Promise.resolve(queryResult).then(resolve, reject),
  });

  return builder;
}

function setupBlogListingFetch({
  categories = [],
  categoriesError = null,
  count,
  featureSettingsResults = [
    { data: { blog_enabled: true }, error: null },
    { data: { blog_enabled: true }, error: null },
  ],
  posts = [],
}: {
  categories?: Array<{ category: string | null }>;
  categoriesError?: unknown;
  count?: number | null;
  featureSettingsResults?: Array<{ data: unknown; error: unknown }>;
  posts?: Array<{
    featured?: boolean | null;
    id: string;
    slug: string | null;
    title: string | null;
    author_name?: string | null;
  }>;
} = {}) {
  const merchantBuilder = createQueryBuilder({
    singleResult: { data: buildBlogMerchantRow(), error: null },
  });
  const primaryDomainBuilder = createQueryBuilder({
    singleResult: { data: null, error: null },
  });
  const featureSettingsBuilders = featureSettingsResults.map((result) =>
    createQueryBuilder({
      singleResult: result,
    })
  );
  const featureSettingsSelects: string[] = [];
  const postsBuilder = createQueryBuilder({
    queryResult: { data: posts, count: count ?? posts.length, error: null },
  });
  const categoriesBuilder = createQueryBuilder({
    queryResult: {
      data: categoriesError ? null : categories,
      error: categoriesError,
    },
  });
  const merchantRpc = createBlogMerchantRpcMock();

  const serviceFrom = vi.fn((table: string) => {
    if (table === 'merchants') {
      return { select: vi.fn(() => merchantBuilder) };
    }

    if (table === 'domains') {
      return { select: vi.fn(() => primaryDomainBuilder) };
    }

    if (table === 'merchant_feature_settings') {
      return {
        select: vi.fn((columns: string) => {
          featureSettingsSelects.push(columns);
          const builder = featureSettingsBuilders.shift();
          if (!builder) {
            throw new Error('Unexpected extra merchant_feature_settings query');
          }
          return builder;
        }),
      };
    }

    throw new Error(`Unexpected service table: ${table}`);
  });

  const blogBuilders = [postsBuilder, categoriesBuilder];
  const blogSelects: ReturnType<typeof vi.fn>[] = [];
  const publicFrom = vi.fn((table: string) => {
    if (table === 'blog_posts') {
      const select = vi.fn(() => {
        const builder = blogBuilders.shift();
        if (!builder) {
          throw new Error('Unexpected extra blog_posts query');
        }
        return builder;
      });
      blogSelects.push(select);
      return { select };
    }

    if (table === 'merchant_feature_settings') {
      return {
        select: vi.fn((columns: string) => {
          featureSettingsSelects.push(columns);
          const builder = featureSettingsBuilders.shift();
          if (!builder) {
            throw new Error('Unexpected extra merchant_feature_settings query');
          }
          return builder;
        }),
      };
    }

    throw new Error(`Unexpected public table: ${table}`);
  });

  mockCreateClient.mockImplementation(
    (_url: string, key: string, _options?: unknown) => {
      if (key === 'test-service-role-key') {
        return { from: serviceFrom, rpc: merchantRpc };
      }

      if (key === 'test-anon-key') {
        return { from: publicFrom, rpc: merchantRpc };
      }

      throw new Error(`Unexpected Supabase key: ${key}`);
    }
  );

  return {
    blogSelects,
    categoriesBuilder,
    featureSettingsSelects,
    postsBuilder,
  };
}

describe('getCachedBlogListing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes public quality filters into the paginated posts query', async () => {
    const { postsBuilder } = setupBlogListingFetch();

    await getCachedBlogListing('ogabassey', { page: 3 });

    expect(postsBuilder.not).toHaveBeenCalledWith('published_at', 'is', null);
    expect(postsBuilder.not).toHaveBeenCalledWith('title', 'is', null);
    expect(postsBuilder.not).toHaveBeenCalledWith('slug', 'is', null);
    expect(postsBuilder.neq).toHaveBeenCalledWith('title', '');
    expect(postsBuilder.neq).toHaveBeenCalledWith('slug', '');
    expect(postsBuilder.not).toHaveBeenCalledWith(
      'title',
      'ilike',
      'test post%'
    );
    expect(postsBuilder.not).toHaveBeenCalledWith(
      'slug',
      'ilike',
      '%agent-integration-working%'
    );
    expect(postsBuilder.range).toHaveBeenCalledWith(24, 35);
    expect(postsBuilder.range.mock.invocationCallOrder[0]).toBeGreaterThan(
      postsBuilder.not.mock.invocationCallOrder.at(-1) ?? 0
    );
    expect(cacheLife).toHaveBeenCalledWith('merchant');
  });

  it('uses estimated counts for public listing pagination to avoid full COUNT scans', async () => {
    const { blogSelects } = setupBlogListingFetch();

    await getCachedBlogListing('ogabassey', { page: 2 });

    expect(blogSelects[0]).toHaveBeenCalledWith(expect.any(String), {
      count: 'estimated',
    });
  });

  it('does not select a missing featured column from blog_posts', async () => {
    const { blogSelects } = setupBlogListingFetch();

    await getCachedBlogListing('ogabassey');

    expect(blogSelects[0]).toHaveBeenCalledWith(
      expect.not.stringContaining('featured,'),
      { count: 'estimated' }
    );
    expect(blogSelects[0]).toHaveBeenCalledWith(
      expect.stringContaining('featured_image_url'),
      { count: 'estimated' }
    );
  });

  it('resolves blog gating from the merchant snapshot without querying feature settings', async () => {
    // Blog gating rides the merchant snapshot's feature_settings, so a pending
    // repairs-flag migration on merchant_feature_settings cannot affect the
    // public blog listing at all — the table is never queried on this path.
    const { featureSettingsSelects } = setupBlogListingFetch({
      featureSettingsResults: [],
      posts: [{ id: 'post-1', slug: 'best-phones', title: 'Best Phones' }],
    });

    const result = await getCachedBlogListing('ogabassey');

    expect(result).not.toBeNull();
    expect(result?.posts.map((post) => post.id)).toEqual(['post-1']);
    expect(featureSettingsSelects).toHaveLength(0);
  });

  it('uses estimated counts for author pagination to avoid full COUNT scans', async () => {
    const { blogSelects } = setupBlogListingFetch({
      posts: [
        {
          id: 'post-1',
          slug: 'best-phones',
          title: 'Best Phones',
          author_name: 'Bassey John',
        },
      ],
    });

    await getCachedBlogAuthor('ogabassey', 'Bassey John', { page: 1 });

    expect(blogSelects[0]).toHaveBeenCalledWith(expect.any(String), {
      count: 'estimated',
    });
  });

  it('removes known junk category values in the categories query', async () => {
    const { categoriesBuilder } = setupBlogListingFetch();

    await getCachedBlogListing('ogabassey');

    expect(categoriesBuilder.not).toHaveBeenCalledWith(
      'published_at',
      'is',
      null
    );
    expect(categoriesBuilder.not).toHaveBeenCalledWith('title', 'is', null);
    expect(categoriesBuilder.not).toHaveBeenCalledWith('slug', 'is', null);
    expect(categoriesBuilder.neq).toHaveBeenCalledWith('title', '');
    expect(categoriesBuilder.neq).toHaveBeenCalledWith('slug', '');
    expect(categoriesBuilder.not).toHaveBeenCalledWith(
      'title',
      'ilike',
      'test post%'
    );
    expect(categoriesBuilder.not).toHaveBeenCalledWith(
      'slug',
      'ilike',
      '%agent-integration-working%'
    );
    expect(categoriesBuilder.not).toHaveBeenCalledWith('category', 'is', null);
    expect(categoriesBuilder.not).toHaveBeenCalledWith(
      'category',
      'ilike',
      'gcrblw'
    );
    expect(categoriesBuilder.not).toHaveBeenCalledWith(
      'category',
      'ilike',
      'test'
    );
  });

  it('normalizes public posts and categories before returning the listing', async () => {
    setupBlogListingFetch({
      posts: [
        { id: 'public-1', slug: 'best-phones', title: 'Best Phones' },
        {
          id: 'junk-1',
          slug: 'test-post-agent-integration-working',
          title: 'Test Post: Agent Integration Working',
        },
      ],
      categories: [
        { category: ' Smartphones ' },
        { category: 'smartphones' },
        { category: 'gcrblw' },
        { category: '' },
      ],
    });

    const result = await getCachedBlogListing('ogabassey');
    expect(result).not.toBeNull();
    if (!result) {
      throw new Error('Expected blog listing result');
    }

    expect(result.posts).toEqual([
      { id: 'public-1', slug: 'best-phones', title: 'Best Phones' },
    ]);
    expect(result.categories).toEqual(['Smartphones']);
  });

  it('keeps category lookup failures request-local and retries them later', async () => {
    setupBlogListingFetch({
      categoriesError: { code: 'PGRST003', message: 'pool timeout' },
      posts: [{ id: 'public-1', slug: 'best-phones', title: 'Best Phones' }],
    });

    const degraded = await getCachedBlogListing('ogabassey');
    expect(degraded).toEqual(
      expect.objectContaining({
        posts: [{ id: 'public-1', slug: 'best-phones', title: 'Best Phones' }],
        categories: [],
      })
    );

    setupBlogListingFetch({
      categories: [{ category: 'Smartphones' }],
      posts: [{ id: 'public-1', slug: 'best-phones', title: 'Best Phones' }],
    });

    const recovered = await getCachedBlogListing('ogabassey');
    expect(recovered?.categories).toEqual(['Smartphones']);
  });

  it('keeps totalPages at least at the current non-empty page when estimated counts undercount', async () => {
    setupBlogListingFetch({
      count: 1,
      posts: [
        {
          id: 'page-3-post',
          slug: 'page-3-post',
          title: 'Page 3 Post',
        },
      ],
    });

    const result = await getCachedBlogListing('ogabassey', { page: 3 });

    expect(result).not.toBeNull();
    expect(result?.posts.map((post) => post.id)).toEqual(['page-3-post']);
    expect(result?.currentPage).toBe(3);
    expect(result?.totalPages).toBeGreaterThanOrEqual(3);
  });
});

describe('getCachedFeatureSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to the legacy feature settings projection while the repairs flag migration is pending', async () => {
    const { featureSettingsSelects } = setupBlogListingFetch({
      featureSettingsResults: [
        {
          data: null,
          error: {
            code: '42703',
            message:
              'column merchant_feature_settings.repairs_catalog_enabled does not exist',
          },
        },
        { data: { blog_enabled: true }, error: null },
      ],
    });

    const settings = await getCachedFeatureSettings('merchant-1');

    expect(settings).toMatchObject({
      blog_enabled: true,
      // Normalized default while the column is missing.
      repairs_catalog_enabled: false,
    });
    expect(featureSettingsSelects).toHaveLength(2);
    expect(featureSettingsSelects[0]).toContain('repairs_catalog_enabled');
    expect(featureSettingsSelects[1]).not.toContain('repairs_catalog_enabled');
  });
});
