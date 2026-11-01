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

import { getCachedBlogAuthor } from '@/lib/cached-data';
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

function setupBlogAuthorFetch({
  posts = [],
  postsError = null,
  count,
}: {
  posts?: unknown[];
  postsError?: unknown;
  count?: number | null;
} = {}) {
  const merchantBuilder = createQueryBuilder({
    singleResult: { data: buildBlogMerchantRow(), error: null },
  });
  const primaryDomainBuilder = createQueryBuilder({
    singleResult: { data: null, error: null },
  });
  const featureSettingsBuilder = createQueryBuilder({
    singleResult: { data: { blog_enabled: true }, error: null },
  });
  const postsBuilder = createQueryBuilder({
    queryResult: {
      data: postsError ? null : posts,
      count: postsError ? null : (count ?? posts.length),
      error: postsError,
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
      return { select: vi.fn(() => featureSettingsBuilder) };
    }

    throw new Error(`Unexpected service table: ${table}`);
  });

  const publicFrom = vi.fn((table: string) => {
    if (table === 'blog_posts') {
      return { select: vi.fn(() => postsBuilder) };
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

  return { postsBuilder };
}

describe('getCachedBlogAuthor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes page input and fetches the author posts with a bounded DB query', async () => {
    const { postsBuilder } = setupBlogAuthorFetch({
      posts: [
        {
          id: 'post-1',
          title: 'Bassey Laptop Guide',
          slug: 'bassey-laptop-guide',
          excerpt: 'Laptop picks.',
          featured_image_url: null,
          featured_image_alt: null,
          category: 'Laptops',
          author_name: 'Bassey John',
          author_title: 'Performance Marketing Specialist',
          author_bio: 'Bassey writes buying guides.',
          author_image_url: 'https://cdn.example.com/bassey.jpg',
          published_at: '2026-03-17T10:00:00.000Z',
          reading_time_minutes: 4,
        },
        {
          id: 'post-2',
          title: 'Bassey Phone Guide',
          slug: 'bassey-phone-guide',
          excerpt: 'Phone picks.',
          featured_image_url: null,
          featured_image_alt: null,
          category: 'Smartphones',
          author_name: 'Bassey John',
          author_title: 'Performance Marketing Specialist',
          author_bio: 'Bassey writes buying guides.',
          author_image_url: 'https://cdn.example.com/bassey.jpg',
          published_at: '2026-03-16T10:00:00.000Z',
          reading_time_minutes: 5,
        },
      ],
    });

    const result = await getCachedBlogAuthor('ogabassey', 'Bassey John', {
      page: -2,
    });

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error('Expected blog author result');
    }
    // Bounded query: filter by author_name + paginate at the DB level (no
    // unbounded fetch + in-memory pagination — Jules Medium finding).
    expect(postsBuilder.eq).toHaveBeenCalledWith('author_name', 'Bassey John');
    expect(postsBuilder.range).toHaveBeenCalledWith(0, expect.any(Number));
    expect(postsBuilder.limit).not.toHaveBeenCalled();
    expect(result.author.name).toBe('Bassey John');
    expect(result.posts.map((post) => post.id)).toEqual(['post-1', 'post-2']);
    expect(result.totalPosts).toBe(2);
    expect(result.currentPage).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('throws when the author posts query fails', async () => {
    const queryError = new Error('author posts query failed');
    setupBlogAuthorFetch({ postsError: queryError });

    await expect(
      getCachedBlogAuthor('ogabassey', 'Bassey John', { page: 1 })
    ).rejects.toThrow('author posts query failed');
  });

  it('returns null when the author has no published public posts', async () => {
    setupBlogAuthorFetch({ posts: [] });

    await expect(
      getCachedBlogAuthor('ogabassey', 'Bassey John', { page: 1 })
    ).resolves.toBeNull();
  });

  it('keeps totalPages for an out-of-range page so the route can redirect (no false 404)', async () => {
    // The ranged window is empty, but the author still has posts (count > 0).
    setupBlogAuthorFetch({ posts: [], count: 30 });

    const result = await getCachedBlogAuthor('ogabassey', 'Bassey John', {
      page: 999,
    });

    expect(result).not.toBeNull();
    expect(result?.posts).toEqual([]);
    expect(result?.totalPosts).toBe(30);
    expect(result?.totalPages).toBe(3);
    expect(result?.currentPage).toBe(999);
  });

  it('keeps totalPages at least at the current non-empty page when estimated author counts undercount', async () => {
    setupBlogAuthorFetch({
      count: 1,
      posts: [
        {
          id: 'page-3-author-post',
          title: 'Bassey Page 3 Guide',
          slug: 'bassey-page-3-guide',
          excerpt: 'Page 3.',
          featured_image_url: null,
          featured_image_alt: null,
          category: 'Laptops',
          author_name: 'Bassey John',
          author_title: 'Performance Marketing Specialist',
          author_bio: 'Bassey writes buying guides.',
          author_image_url: 'https://cdn.example.com/bassey.jpg',
          published_at: '2026-03-15T10:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
    });

    const result = await getCachedBlogAuthor('ogabassey', 'Bassey John', {
      page: 3,
    });

    expect(result).not.toBeNull();
    expect(result?.posts.map((post) => post.id)).toEqual([
      'page-3-author-post',
    ]);
    expect(result?.currentPage).toBe(3);
    expect(result?.totalPages).toBeGreaterThanOrEqual(3);
  });

  it('resolves author profile metadata from the first post in the window with non-empty E-E-A-T fields', async () => {
    setupBlogAuthorFetch({
      posts: [
        {
          id: 'post-newest-missing-eeat',
          title: 'Bassey Newest Guide',
          slug: 'bassey-newest-guide',
          excerpt: 'Newest picks.',
          featured_image_url: null,
          featured_image_alt: null,
          category: 'Laptops',
          author_name: 'Bassey John',
          author_title: null,
          author_bio: null,
          author_image_url: null,
          published_at: '2026-03-18T10:00:00.000Z',
          reading_time_minutes: 4,
        },
        {
          id: 'post-older-with-eeat',
          title: 'Bassey Older Guide',
          slug: 'bassey-older-guide',
          excerpt: 'Older picks.',
          featured_image_url: null,
          featured_image_alt: null,
          category: 'Smartphones',
          author_name: 'Bassey John',
          author_title: 'Performance Marketing Specialist',
          author_bio: 'Bassey writes buying guides.',
          author_image_url: 'https://cdn.example.com/bassey.jpg',
          published_at: '2026-03-17T10:00:00.000Z',
          reading_time_minutes: 5,
        },
      ],
    });

    const result = await getCachedBlogAuthor('ogabassey', 'Bassey John', {
      page: 1,
    });

    expect(result?.author).toEqual({
      name: 'Bassey John',
      title: 'Performance Marketing Specialist',
      bio: 'Bassey writes buying guides.',
      imageUrl: 'https://cdn.example.com/bassey.jpg',
    });
  });
});
