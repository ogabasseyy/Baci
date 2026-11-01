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

import { cacheLife, cacheTag } from 'next/cache';
import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { getCachedBlogPost } from '@/lib/cached-data';
import { STOREFRONT_BLOG_POST_SELECT } from '@/lib/storefront-blog-post-select';

function createQueryBuilder({
  queryResult = { data: [], error: null },
  singleResult = { data: null, error: null },
}: {
  queryResult?: { data: unknown; error: unknown };
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
    single: vi.fn().mockResolvedValue(singleResult),
  };

  Object.defineProperty(builder, 'then', {
    value: (
      resolve: (value: { data: unknown; error: unknown }) => void,
      reject?: (reason: unknown) => void
    ) => Promise.resolve(queryResult).then(resolve, reject),
  });

  return builder;
}

// Shared fixture helpers — keep individual tests focused on the behavior
// under assertion instead of restating the full merchant/post row shape.
function buildMerchantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'merchant-1',
    business_name: 'Ogabassey',
    site_title: 'Ogabassey',
    site_tagline: 'Phones and tablets',
    site_description: 'Phones and tablets',
    business_type: 'electronics',
    logo_url: 'https://cdn.example.com/logo.png',
    phone: '+234800000000',
    email: 'hello@ogabassey.com',
    social_media: null,
    brand_colors: null,
    slug: 'ogabassey',
    business_address: 'Lagos',
    payout_currency: 'NGN',
    is_published: true,
    template_id: 'default',
    plan_tier: 'pro',
    premium_features: null,
    country: 'NG',
    hero_slides: null,
    favicon_svg_url: null,
    favicon_png_32_url: null,
    favicon_apple_touch_url: null,
    vat_registration_status: null,
    vat_rate: null,
    feature_settings: { blog_enabled: true },
    pages: null,
    about_page: null,
    faq_items: null,
    updated_at: '2026-03-28T00:00:00.000Z',
    ...overrides,
  };
}

function buildBlogPostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    slug: 'factory-unlocked-iphones-explained',
    title: 'Factory Unlocked iPhones: Explained',
    ...overrides,
  };
}

interface BlogPostFetchMocks {
  categoryRelatedPostsResult?: { data: unknown; error: unknown };
  merchantRow: Record<string, unknown>;
  postLookupError?: unknown;
  publishedPost: Record<string, unknown>;
  linkedProductsResult?: { data: unknown; error: unknown };
  relatedPostsResult?: { data: unknown; error: unknown };
}

function setupBlogPostFetch({
  categoryRelatedPostsResult,
  linkedProductsResult,
  merchantRow,
  postLookupError,
  publishedPost,
  relatedPostsResult,
}: BlogPostFetchMocks) {
  const featureSettingsBuilder = createQueryBuilder({
    singleResult: { data: { blog_enabled: true }, error: null },
  });
  const postLookupBuilder = createQueryBuilder({
    singleResult: {
      data: postLookupError ? null : publishedPost,
      error: postLookupError ?? null,
    },
  });
  const relatedPostsBuilder = createQueryBuilder({
    queryResult: relatedPostsResult,
  });
  const categoryRelatedPostsBuilder = createQueryBuilder({
    queryResult: categoryRelatedPostsResult,
  });
  const linkedProductsBuilder = createQueryBuilder({
    queryResult: linkedProductsResult,
  });
  const relatedProductsBuilder = createQueryBuilder({});

  // Merchant-by-domain resolution happens in one public-safe bounded RPC.
  const serviceRpc = vi.fn((fnName: string) => {
    if (fnName === 'resolve_storefront_public_snapshot_v2') {
      return Promise.resolve({
        data: [
          {
            resolution_status: 'found',
            custom_domain: 'ogabassey.com',
            feature_settings: merchantRow.feature_settings ?? null,
            merchant_data: merchantRow,
          },
        ],
        error: null,
        status: 200,
      });
    }

    throw new Error(`Unexpected service RPC: ${fnName}`);
  });

  const serviceFrom = vi.fn((table: string) => {
    if (table === 'merchant_feature_settings') {
      return { select: vi.fn(() => featureSettingsBuilder) };
    }

    throw new Error(`Unexpected service table: ${table}`);
  });

  const blogBuilders = [
    postLookupBuilder,
    relatedPostsBuilder,
    categoryRelatedPostsBuilder,
  ];
  const publicFrom = vi.fn((table: string) => {
    if (table === 'blog_posts') {
      return {
        select: vi.fn(() => {
          const builder = blogBuilders.shift();
          if (!builder) {
            throw new Error('Unexpected extra blog_posts query');
          }
          return builder;
        }),
      };
    }

    if (table === 'blog_post_products') {
      return {
        select: vi.fn(() => linkedProductsBuilder),
      };
    }

    if (table === 'products') {
      return {
        select: vi.fn(() => relatedProductsBuilder),
      };
    }

    throw new Error(`Unexpected public table: ${table}`);
  });

  mockCreateClient.mockImplementation(
    (_url: string, key: string, _options?: unknown) => {
      if (key === 'test-service-role-key') {
        return { from: serviceFrom, rpc: serviceRpc };
      }

      if (key === 'test-anon-key') {
        return { from: publicFrom, rpc: serviceRpc };
      }

      throw new Error(`Unexpected Supabase key: ${key}`);
    }
  );

  return {
    categoryRelatedPostsBuilder,
    linkedProductsBuilder,
    postLookupBuilder,
    relatedPostsBuilder,
    relatedProductsBuilder,
  };
}

describe('getCachedBlogPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches source blog tags and keywords for semantic related ranking', () => {
    expect(STOREFRONT_BLOG_POST_SELECT).toContain('tags');
    expect(STOREFRONT_BLOG_POST_SELECT).toContain('keywords');
  });

  it('preserves the merchant custom domain for domain-based blog post lookups', async () => {
    setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      publishedPost: buildBlogPostRow(),
    });

    const result = await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );

    expect(result?.merchant).toEqual(
      expect.objectContaining({
        business_name: 'Ogabassey',
        custom_domain: 'ogabassey.com',
        slug: 'ogabassey',
      })
    );
    expect(cacheTag).toHaveBeenCalledWith(
      'blog-posts',
      getBlogCacheTag('ogabassey.com', 'factory-unlocked-iphones-explained')
    );
    expect(cacheTag).toHaveBeenCalledWith(
      'blog-posts',
      'products',
      'products-merchant-1'
    );
    expect(cacheLife).toHaveBeenCalledWith('blog');
  });

  it('throws a core post query failure instead of caching it as not found', async () => {
    const queryError = { code: '57014', message: 'statement timeout' };
    setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      postLookupError: queryError,
      publishedPost: buildBlogPostRow(),
    });

    await expect(
      getCachedBlogPost('ogabassey.com', 'factory-unlocked-iphones-explained')
    ).rejects.toEqual(queryError);
  });

  it('returns null for the explicit PostgREST no-row result', async () => {
    setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      postLookupError: { code: 'PGRST116', message: 'No rows found' },
      publishedPost: buildBlogPostRow(),
    });

    await expect(
      getCachedBlogPost('ogabassey.com', 'missing-blog-post')
    ).resolves.toBeNull();
  });

  it('keeps optional enrichment failures request-local and retries them later', async () => {
    setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      publishedPost: buildBlogPostRow(),
      relatedPostsResult: {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
      },
    });

    const degraded = await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );
    expect(degraded).toEqual(
      expect.objectContaining({
        post: expect.objectContaining({ id: 'post-1' }),
        relatedPosts: [],
        relatedProducts: [],
      })
    );

    setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      publishedPost: buildBlogPostRow({ category: null }),
      relatedPostsResult: {
        data: [
          {
            id: 'recovered-related-post',
            slug: 'recovered-related-post',
            title: 'Recovered related post',
          },
        ],
        error: null,
      },
    });

    const recovered = await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );
    expect(recovered?.relatedPosts).toEqual([
      {
        id: 'recovered-related-post',
        slug: 'recovered-related-post',
        title: 'Recovered related post',
      },
    ]);
  });

  it('excludes published posts without a published_at timestamp from detail and related queries', async () => {
    const { postLookupBuilder, relatedPostsBuilder } = setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      publishedPost: buildBlogPostRow(),
    });

    await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );

    expect(postLookupBuilder.not).toHaveBeenCalledWith(
      'published_at',
      'is',
      null
    );
    expect(relatedPostsBuilder.not).toHaveBeenCalledWith(
      'published_at',
      'is',
      null
    );
    expect(relatedPostsBuilder.not).toHaveBeenCalledWith('title', 'is', null);
    expect(relatedPostsBuilder.not).toHaveBeenCalledWith('slug', 'is', null);
    expect(relatedPostsBuilder.not).toHaveBeenCalledWith(
      'title',
      'ilike',
      'test post%'
    );
    expect(relatedPostsBuilder.not).toHaveBeenCalledWith(
      'slug',
      'ilike',
      '%agent-integration-working%'
    );
    expect(relatedPostsBuilder.limit).toHaveBeenCalledWith(36);
  });

  it('adds a bounded same-category candidate pool for older semantic matches', async () => {
    const { categoryRelatedPostsBuilder } = setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      publishedPost: buildBlogPostRow({
        category: 'Laptops',
        tags: ['Apple', 'MacBook'],
        keywords: ['macbook buyer guide'],
        title: 'MacBook buyer guide',
      }),
      relatedPostsResult: {
        data: [
          {
            id: 'recent-phone',
            slug: 'recent-phone-news',
            title: 'Recent phone news',
            category: 'Smartphones',
            published_at: '2026-06-08T12:00:00Z',
          },
        ],
        error: null,
      },
      categoryRelatedPostsResult: {
        data: [
          {
            id: 'older-macbook',
            slug: 'older-macbook-guide',
            title: 'Older MacBook buying guide',
            category: 'Laptops',
            tags: ['Apple', 'MacBook'],
            keywords: ['macbook buyer guide'],
            published_at: '2026-01-08T12:00:00Z',
          },
        ],
        error: null,
      },
    });

    const result = await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );

    expect(categoryRelatedPostsBuilder.eq).toHaveBeenCalledWith(
      'category',
      'Laptops'
    );
    expect(categoryRelatedPostsBuilder.limit).toHaveBeenCalledWith(80);
    expect(result?.relatedPosts.map((post) => post.id)).toEqual([
      'older-macbook',
      'recent-phone',
    ]);
  });

  it('slugifies free-text blog categories before filtering related products', async () => {
    const { relatedProductsBuilder } = setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      publishedPost: buildBlogPostRow({ category: 'Product News' }),
    });

    await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );

    expect(relatedProductsBuilder.eq).toHaveBeenCalledWith(
      'categories.slug',
      'product-news'
    );
    expect(relatedProductsBuilder.eq).not.toHaveBeenCalledWith(
      'category_slug',
      expect.anything()
    );
  });

  it('uses explicit blog product links before category fallback products', async () => {
    const { linkedProductsBuilder, relatedProductsBuilder } =
      setupBlogPostFetch({
        merchantRow: buildMerchantRow(),
        publishedPost: buildBlogPostRow({ category: 'Accessories' }),
        linkedProductsResult: {
          data: [
            {
              product: {
                id: 'ipad-10',
                name: 'iPad 10th Gen',
                slug: 'ipad-10th-gen-2022',
                status: 'active',
                categories: { slug: 'tablets' },
              },
            },
          ],
          error: null,
        },
      });

    const result = await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );

    expect(linkedProductsBuilder.eq).toHaveBeenCalledWith(
      'blog_post_id',
      'post-1'
    );
    expect(relatedProductsBuilder.eq).not.toHaveBeenCalledWith(
      'categories.slug',
      expect.anything()
    );
    expect(result?.relatedProducts).toEqual([
      {
        id: 'ipad-10',
        name: 'iPad 10th Gen',
        slug: 'ipad-10th-gen-2022',
        category_slug: 'tablets',
      },
    ]);
  });

  it('filters inactive explicit blog product links before limiting results', async () => {
    const inactiveLinks = Array.from({ length: 8 }, (_value, index) => ({
      product: {
        id: `inactive-${index}`,
        name: `Inactive ${index}`,
        slug: `inactive-${index}`,
        status: 'draft',
        categories: { slug: 'accessories' },
      },
    }));
    const { linkedProductsBuilder, relatedProductsBuilder } =
      setupBlogPostFetch({
        merchantRow: buildMerchantRow(),
        publishedPost: buildBlogPostRow({ category: 'Accessories' }),
        linkedProductsResult: {
          data: [
            ...inactiveLinks,
            {
              product: {
                id: 'ipad-active',
                name: 'iPad Active',
                slug: 'ipad-active',
                status: 'active',
                categories: { slug: 'tablets' },
              },
            },
          ],
          error: null,
        },
      });

    const result = await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );

    expect(linkedProductsBuilder.eq).toHaveBeenCalledWith(
      'blog_post_id',
      'post-1'
    );
    expect(linkedProductsBuilder.limit).not.toHaveBeenCalledWith(8);
    expect(relatedProductsBuilder.eq).not.toHaveBeenCalledWith(
      'categories.slug',
      expect.anything()
    );
    expect(result?.relatedProducts).toEqual([
      {
        id: 'ipad-active',
        name: 'iPad Active',
        slug: 'ipad-active',
        category_slug: 'tablets',
      },
    ]);
  });

  it('returns null for public test posts instead of exposing direct article URLs', async () => {
    setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      publishedPost: buildBlogPostRow({
        slug: 'test-post-agent-integration-working',
        title: 'Test Post: Agent Integration Working',
      }),
    });

    const result = await getCachedBlogPost(
      'ogabassey.com',
      'test-post-agent-integration-working'
    );

    expect(result).toBeNull();
  });

  it('filters test posts from cached related posts', async () => {
    setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      publishedPost: buildBlogPostRow({ category: null }),
      relatedPostsResult: {
        data: [
          {
            id: 'related-1',
            slug: 'best-phones-in-nigeria',
            title: 'Best Phones in Nigeria',
          },
          {
            id: 'related-2',
            slug: 'test-post-agent-integration-working',
            title: 'Test Post: Agent Integration Working',
          },
        ],
        error: null,
      },
    });

    const result = await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );

    expect(result?.relatedPosts).toEqual([
      {
        id: 'related-1',
        slug: 'best-phones-in-nigeria',
        title: 'Best Phones in Nigeria',
      },
    ]);
  });

  it('over-fetches related posts so public entries can still fill all slots', async () => {
    setupBlogPostFetch({
      merchantRow: buildMerchantRow(),
      publishedPost: buildBlogPostRow({ category: null }),
      relatedPostsResult: {
        data: [
          {
            id: 'related-junk-1',
            slug: 'test-post-agent-integration-working-1',
            title: 'Test Post: Agent Integration Working',
          },
          {
            id: 'related-junk-2',
            slug: 'test-post-agent-integration-working-2',
            title: 'Test Post: Agent Integration Working',
          },
          {
            id: 'related-1',
            slug: 'best-phones-in-nigeria',
            title: 'Best Phones in Nigeria',
          },
          {
            id: 'related-2',
            slug: 'budget-phones-in-nigeria',
            title: 'Budget Phones in Nigeria',
          },
          {
            id: 'related-3',
            slug: 'camera-phones-in-nigeria',
            title: 'Camera Phones in Nigeria',
          },
        ],
        error: null,
      },
    });

    const result = await getCachedBlogPost(
      'ogabassey.com',
      'factory-unlocked-iphones-explained'
    );

    expect(result?.relatedPosts).toEqual([
      {
        id: 'related-1',
        slug: 'best-phones-in-nigeria',
        title: 'Best Phones in Nigeria',
      },
      {
        id: 'related-2',
        slug: 'budget-phones-in-nigeria',
        title: 'Budget Phones in Nigeria',
      },
      {
        id: 'related-3',
        slug: 'camera-phones-in-nigeria',
        title: 'Camera Phones in Nigeria',
      },
    ]);
  });
});
