import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMerchantSafe = vi.fn();
const mockSingle = vi.fn();
const mockGetOrderedLinks = vi.fn();
const mockHydrateAvailability = vi.fn(
  async (_supabase: unknown, products: unknown[]) => [...products]
);

vi.mock('@/lib/cached-data', () => ({
  getMerchantSafe: (...args: unknown[]) => mockGetMerchantSafe(...args),
}));
vi.mock('@/lib/storefront-blog-post-select', () => ({
  STOREFRONT_BLOG_POST_SELECT: 'id, title, slug',
}));
vi.mock('@/lib/ordered-blog-post-product-links', () => ({
  getOrderedBlogPostProductLinks: (...args: unknown[]) =>
    mockGetOrderedLinks(...args),
}));
vi.mock('@/lib/hydrate-related-blog-product-availability', () => ({
  hydrateRelatedBlogProductAvailability: (...args: never[]) =>
    (mockHydrateAvailability as (...args: never[]) => unknown)(...args),
}));

const mockQueryBuilder: Record<string, unknown> = {};
mockQueryBuilder.eq = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.neq = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.not = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.order = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.limit = vi.fn(() => mockQueryBuilder);
mockQueryBuilder.single = mockSingle;
Object.defineProperty(mockQueryBuilder, 'then', {
  value: (resolve: (val: { data: unknown; error: unknown }) => void) =>
    Promise.resolve({ data: [], error: null }).then(resolve),
});

vi.mock('@/lib/supabase/anon', () => ({
  createPublicClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => mockQueryBuilder),
    })),
  })),
}));

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

function linkRow(id: string, index: number) {
  return {
    product: {
      id,
      name: `Product ${index}`,
      slug: `product-${index}`,
      status: 'active',
    },
  };
}

describe('getLiveBlogPost catalog selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a ninth linked product referenced by the article body', async () => {
    // Arrange: nine linked products; the article references only the ninth.
    const ninthId = '12345678-90ab-cdef-1234-567890abcdef';
    const links = Array.from({ length: 8 }, (_, index) =>
      linkRow(`00000000-0000-4000-8000-00000000000${index}`, index)
    );
    links.push(linkRow(ninthId, 9));
    mockGetMerchantSafe.mockResolvedValue(mockMerchant);
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'post-1',
        title: 'Buying guide',
        slug: 'buying-guide',
        category: 'tech',
        content: `Our pick: {{catalog-price:${ninthId}}}.`,
      },
      error: null,
    });
    mockGetOrderedLinks.mockResolvedValue({ data: links, error: null });

    // Act
    const result = await getLiveBlogPost('test-store', 'buying-guide');

    // Assert: content-aware selection (mirroring the cached path) retains
    // the referenced ninth product for hydration instead of truncating it.
    expect(result?.relatedProducts).toHaveLength(9);
    expect(
      result?.relatedProducts.some((product) => product.id === ninthId)
    ).toBe(true);
    expect(mockHydrateAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ id: ninthId })]),
      { merchantId: 'merchant-123' }
    );
  });
});
