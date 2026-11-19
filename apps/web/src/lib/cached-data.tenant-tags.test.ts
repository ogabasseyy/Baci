import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('react', () => ({ cache: vi.fn((fn) => fn) }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { cacheTag } from 'next/cache';
import {
  getCachedBlogAuthor,
  getCachedBlogListing,
  getCachedBlogPost,
  getCachedMerchant,
  getCachedMerchantByDomain,
  getCachedMerchantById,
} from '@/lib/cached-data';
import {
  buildCachedDataTestHarness,
  createBlogMerchantRpcMock,
  mockMerchant,
  resolvedStorefrontMerchantRpcResult,
} from '@/lib/cached-data.test-utils';

function collectCacheTags(): string[] {
  return vi.mocked(cacheTag).mock.calls.flat() as string[];
}

function createBlogPostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    title: 'Buying Guide',
    slug: 'buying-guide',
    content: '<p>Hello</p>',
    excerpt: 'Summary',
    category: 'Guides',
    tags: [],
    keywords: [],
    featured_image_url: null,
    featured_image_alt: null,
    author_name: 'Bassey John',
    author_title: 'Editor',
    author_bio: 'Writes guides.',
    author_image_url: null,
    published_at: '2026-03-17T10:00:00.000Z',
    updated_at: '2026-03-17T10:00:00.000Z',
    reading_time_minutes: 3,
    view_count: 10,
    seo_title: null,
    seo_description: null,
    focus_keyword: null,
    status: 'published',
    ...overrides,
  };
}

function createChainQuery(result: {
  count?: number | null;
  data: unknown;
  error: unknown;
}) {
  const builder = {
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(result),
    neq: vi.fn(() => builder),
    not: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(result),
  };

  Object.defineProperty(builder, 'then', {
    value: (
      resolve: (value: typeof result) => void,
      reject?: (reason: unknown) => void
    ) => Promise.resolve(result).then(resolve, reject),
  });

  return builder;
}

describe('cached-data tenant-scoped cacheTag attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches merchant-id, slug, and domain tags on getCachedMerchant', async () => {
    const harness = buildCachedDataTestHarness();
    harness.mockRpc.mockResolvedValueOnce(
      resolvedStorefrontMerchantRpcResult(mockMerchant, {
        customDomain: 'Shop.Example.COM',
      })
    );
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
    });

    await getCachedMerchant('Test-Store');

    expect(collectCacheTags()).toEqual(
      expect.arrayContaining([
        'merchants',
        'merchant-test-store',
        'merchant-slug-test-store',
        `merchant-id-${mockMerchant.id}`,
        `features-${mockMerchant.id}`,
        'domain-shop.example.com',
        'merchant-shop.example.com',
      ])
    );
  });

  it('attaches domain, merchant-id, and slug tags on getCachedMerchantByDomain', async () => {
    const harness = buildCachedDataTestHarness();
    harness.mockRpc.mockResolvedValueOnce(
      resolvedStorefrontMerchantRpcResult(mockMerchant, {
        customDomain: 'shop.example.com',
      })
    );
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
    });

    await getCachedMerchantByDomain('Shop.Example.COM');

    expect(collectCacheTags()).toEqual(
      expect.arrayContaining([
        'merchants',
        'domains',
        'domain-shop.example.com',
        'merchant-shop.example.com',
        `merchant-id-${mockMerchant.id}`,
        'merchant-test-store',
        'merchant-slug-test-store',
      ])
    );
  });

  it('attaches slug tags alongside merchant-id on getCachedMerchantById', async () => {
    const harness = buildCachedDataTestHarness();
    harness.mockSingle.mockResolvedValueOnce({
      data: mockMerchant,
      error: null,
    });
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
    });

    await getCachedMerchantById(mockMerchant.id);

    expect(collectCacheTags()).toEqual(
      expect.arrayContaining([
        'merchants',
        `merchant-id-${mockMerchant.id}`,
        'merchant-test-store',
        'merchant-slug-test-store',
      ])
    );
  });

  it('attaches tenant and identifier blog tags on getCachedBlogPost', async () => {
    const postRow = createBlogPostRow();
    const rpc = createBlogMerchantRpcMock();
    const blogQueries = [
      createChainQuery({ data: postRow, error: null }),
      createChainQuery({ data: [], error: null }),
    ];
    const from = vi.fn((table: string) => {
      if (table === 'blog_posts') {
        return {
          select: vi.fn(
            () =>
              blogQueries.shift() ?? createChainQuery({ data: [], error: null })
          ),
        };
      }
      if (table === 'blog_post_products' || table === 'products') {
        return {
          select: vi.fn(() => createChainQuery({ data: [], error: null })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mockCreateClient.mockReturnValue({ from, rpc });

    await getCachedBlogPost('Ogabassey.COM', 'buying-guide');

    expect(collectCacheTags()).toEqual(
      expect.arrayContaining([
        'blog-posts',
        'blog-identifier-ogabassey.com',
        'merchant-id-merchant-1',
        'blog-posts-merchant-1',
        'blog-content-links-merchant-1',
      ])
    );
  });

  it('attaches tenant blog listing and categories tags on getCachedBlogListing', async () => {
    const rpc = createBlogMerchantRpcMock();
    const blogQueries = [
      createChainQuery({ data: [createBlogPostRow()], count: 1, error: null }),
      createChainQuery({ data: [{ category: 'Guides' }], error: null }),
    ];
    const from = vi.fn((table: string) => {
      if (table === 'blog_posts') {
        return {
          select: vi.fn(
            () =>
              blogQueries.shift() ?? createChainQuery({ data: [], error: null })
          ),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mockCreateClient.mockReturnValue({ from, rpc });

    await getCachedBlogListing('Ogabassey', { page: 1 });

    expect(collectCacheTags()).toEqual(
      expect.arrayContaining([
        'blog-posts',
        'blog-identifier-ogabassey',
        'blog-list-ogabassey-all-1',
        'merchant-id-merchant-1',
        'blog-posts-merchant-1',
        'blog-categories-merchant-1',
      ])
    );
  });

  it('attaches tenant blog tags on getCachedBlogAuthor', async () => {
    const rpc = createBlogMerchantRpcMock();
    const from = vi.fn((table: string) => {
      if (table === 'blog_posts') {
        return {
          select: vi.fn(() =>
            createChainQuery({
              data: [createBlogPostRow()],
              count: 1,
              error: null,
            })
          ),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mockCreateClient.mockReturnValue({ from, rpc });

    await getCachedBlogAuthor('Ogabassey', 'Bassey John', { page: 1 });

    expect(collectCacheTags()).toEqual(
      expect.arrayContaining([
        'blog-posts',
        'blog-identifier-ogabassey',
        'blog-author-ogabassey-bassey-john-1',
        'merchant-id-merchant-1',
        'blog-posts-merchant-1',
      ])
    );
  });
});
