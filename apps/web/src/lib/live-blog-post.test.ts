import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cached-data', () => ({
  getMerchantSafe: vi.fn(),
}));

vi.mock('@/lib/storefront-blog-post-select', () => ({
  STOREFRONT_BLOG_POST_SELECT: 'id, title, slug',
}));

const mockSingle = vi.fn();
const mockEditorSingle = vi.fn();
const mockEditorFrom = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: mockEditorFrom }),
}));

// Mutable result that `.then()` on the builder resolves with.
// Tests set this before calling getLiveBlogPost to control related-posts output.
const relatedQueryResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};

const mockQueryBuilder: Record<string, unknown> = {};
mockQueryBuilder.eq = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.neq = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.not = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.order = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.limit = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.single = mockSingle;
Object.defineProperty(mockQueryBuilder, 'then', {
  value: (
    resolve: (val: { data: unknown; error: unknown }) => void,
    reject?: (err: unknown) => void
  ) => Promise.resolve(relatedQueryResult).then(resolve, reject),
});

vi.mock('@/lib/supabase/anon', () => ({
  createPublicClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => mockQueryBuilder),
    })),
  })),
}));

import { getMerchantSafe } from '@/lib/cached-data';
import { getLiveBlogPost } from '@/lib/live-blog-post';

const mockMerchant = {
  id: 'merchant-123',
  business_name: 'Test Store',
  slug: 'test-store',
  logo_url: 'https://example.com/logo.png',
  custom_domain: 'shop.example.com',
  country: 'IN',
  feature_settings: { blog_enabled: true },
};

describe('getLiveBlogPost', () => {
  it('uses the editor session for the draft and fails closed on an RLS miss', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);
    mockEditorFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ eq: () => ({ single: mockEditorSingle }) }),
      }),
    });
    mockEditorSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116' },
    });

    await expect(
      getLiveBlogPost('test-store', 'draft-post', true)
    ).resolves.toBeNull();
    expect(mockEditorFrom).toHaveBeenCalledWith('blog_posts');
    expect(mockEditorSingle).toHaveBeenCalledOnce();
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it('returns an authorized draft with public related posts', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);
    const draft = { id: 'draft-id', slug: 'draft-post', status: 'draft' };
    const related = { id: 'related-id', slug: 'related', title: 'Related' };
    mockEditorFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ eq: () => ({ single: mockEditorSingle }) }),
      }),
    });
    mockEditorSingle.mockResolvedValue({ data: draft, error: null });
    relatedQueryResult.data = [related];

    await expect(
      getLiveBlogPost('test-store', 'draft-post', true)
    ).resolves.toMatchObject({ post: draft, relatedPosts: [related] });
    expect(mockEditorFrom).toHaveBeenCalledExactlyOnceWith('blog_posts');
    expect(mockSingle).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    relatedQueryResult.data = [];
    relatedQueryResult.error = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when postSlug is empty', async () => {
    const result = await getLiveBlogPost('test-store', '');
    expect(result).toBeNull();
  });

  it('returns null when postSlug is only whitespace', async () => {
    const result = await getLiveBlogPost('test-store', '   ');
    expect(result).toBeNull();
  });

  it('looks up merchant by domain when identifier contains a dot and no slash', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(null);

    const result = await getLiveBlogPost('shop.example.com', 'my-post');
    expect(getMerchantSafe).toHaveBeenCalledWith('shop.example.com');
    expect(result).toBeNull();
  });

  it('looks up merchant by slug when identifier has no dot', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(null);

    const result = await getLiveBlogPost('test-store', 'my-post');
    expect(getMerchantSafe).toHaveBeenCalledWith('test-store');
    expect(result).toBeNull();
  });

  it('returns null when merchant is not found', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(null);

    const result = await getLiveBlogPost('unknown-store', 'my-post');
    expect(result).toBeNull();
  });

  it('returns null when blog is not enabled', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue({
      ...mockMerchant,
      feature_settings: { blog_enabled: false },
    } as never);

    const result = await getLiveBlogPost('test-store', 'my-post');
    expect(result).toBeNull();
  });

  it('returns null when blog post is not found', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'Not found' },
    });

    const result = await getLiveBlogPost('test-store', 'my-post');
    expect(result).toBeNull();
  });

  it('returns post with merchant data and related posts on success', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);

    const mockPost = {
      id: 'post-1',
      title: 'Useful Post',
      slug: 'my-post',
      category: 'tech',
    };

    mockSingle.mockResolvedValueOnce({ data: mockPost, error: null });

    relatedQueryResult.data = [
      { id: 'related-1', slug: 'related-post', title: 'Related Post' },
    ];
    relatedQueryResult.error = null;

    const result = await getLiveBlogPost('test-store', 'my-post');

    expect(result).not.toBeNull();
    expect(result?.merchant.id).toBe('merchant-123');
    expect(result?.merchant.business_name).toBe('Test Store');
    expect(result?.merchant.country).toBe('IN');
    expect(result?.post).toEqual(mockPost);
    expect(result?.relatedPosts).toEqual([
      { id: 'related-1', slug: 'related-post', title: 'Related Post' },
    ]);
  });

  it('excludes published posts without a published_at timestamp from live detail and related queries', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);

    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'post-1',
        title: 'Useful Post',
        slug: 'my-post',
        category: null,
      },
      error: null,
    });

    await getLiveBlogPost('test-store', 'my-post');

    expect(mockQueryBuilder.not).toHaveBeenCalledWith(
      'published_at',
      'is',
      null
    );
    expect(mockQueryBuilder.not).toHaveBeenCalledWith('title', 'is', null);
    expect(mockQueryBuilder.not).toHaveBeenCalledWith('slug', 'is', null);
    expect(mockQueryBuilder.not).toHaveBeenCalledWith(
      'title',
      'ilike',
      'test post%'
    );
    expect(mockQueryBuilder.not).toHaveBeenCalledWith(
      'slug',
      'ilike',
      '%agent-integration-working%'
    );
    expect(mockQueryBuilder.limit).toHaveBeenCalledWith(12);
  });

  it('slugifies free-text blog categories before filtering related products', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);

    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'post-1',
        title: 'Useful Post',
        slug: 'my-post',
        category: 'Product News',
      },
      error: null,
    });

    relatedQueryResult.data = [];
    relatedQueryResult.error = null;

    await getLiveBlogPost('test-store', 'my-post');

    expect(mockQueryBuilder.eq).toHaveBeenCalledWith(
      'categories.slug',
      'product-news'
    );
    expect(mockQueryBuilder.eq).not.toHaveBeenCalledWith(
      'category_slug',
      expect.anything()
    );
  });

  it('returns empty relatedPosts when related posts query errors', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);

    const mockPost = {
      id: 'post-1',
      title: 'Useful Post',
      slug: 'my-post',
      category: null,
    };

    mockSingle.mockResolvedValueOnce({ data: mockPost, error: null });

    relatedQueryResult.data = null;
    relatedQueryResult.error = { message: 'DB error' };

    const result = await getLiveBlogPost('test-store', 'my-post');

    expect(result).not.toBeNull();
    expect(result?.relatedPosts).toEqual([]);
  });

  it('filters test and agent-integration posts from related posts', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);

    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'post-1',
        title: 'Useful Post',
        slug: 'useful-post',
        category: null,
      },
      error: null,
    });

    relatedQueryResult.data = [
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
    ];
    relatedQueryResult.error = null;

    const result = await getLiveBlogPost('test-store', 'useful-post');

    expect(result?.relatedPosts).toEqual([
      {
        id: 'related-1',
        slug: 'best-phones-in-nigeria',
        title: 'Best Phones in Nigeria',
      },
    ]);
  });

  it('over-fetches related live posts so valid entries still fill all slots', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);

    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'post-1',
        title: 'Useful Post',
        slug: 'useful-post',
        category: null,
      },
      error: null,
    });

    relatedQueryResult.data = [
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
    ];
    relatedQueryResult.error = null;

    const result = await getLiveBlogPost('test-store', 'useful-post');

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

  it('returns null for public test posts instead of exposing direct article URLs', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);

    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'post-1',
        title: 'Test Post: Agent Integration Working',
        slug: 'test-post-agent-integration-working',
        category: null,
      },
      error: null,
    });

    const result = await getLiveBlogPost(
      'test-store',
      'test-post-agent-integration-working'
    );

    expect(result).toBeNull();
  });

  it('normalizes postSlug to lowercase and trimmed', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    await getLiveBlogPost('test-store', '  My-Post  ');

    // The slug should be normalized before being used in the query
    expect(mockQueryBuilder.eq).toHaveBeenCalledWith('slug', 'my-post');
  });

  it('does not filter related products by category relation when post category is empty/whitespace', async () => {
    // Negative case: the slugifier returns null for whitespace-only categories,
    // so the related-products query should skip the category relation filter
    // filter rather than query with an empty or normalized-null value.
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);

    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'post-1',
        title: 'Useful Post',
        slug: 'my-post',
        // whitespace-only category — slugifier returns null
        category: '   ',
      },
      error: null,
    });

    relatedQueryResult.data = [];
    relatedQueryResult.error = null;

    const result = await getLiveBlogPost('test-store', 'my-post');

    expect(result).not.toBeNull();
    // Related-products branch should be skipped entirely — no `.eq` call on
    // category relation filter should not appear (the products query is skipped).
    expect(mockQueryBuilder.eq).not.toHaveBeenCalledWith(
      'categories.slug',
      expect.anything()
    );
    expect(result?.relatedProducts).toEqual([]);
  });

  it('returns null and logs error for non-PGRST116 post errors', async () => {
    vi.mocked(getMerchantSafe).mockResolvedValue(mockMerchant as never);

    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST500', message: 'Internal error' },
    });

    const result = await getLiveBlogPost('test-store', 'my-post');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error fetching live blog post:',
      expect.objectContaining({ code: 'PGRST500' })
    );
  });
});
