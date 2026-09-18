import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateAnonClient = vi.fn();

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => mockCreateAnonClient(),
}));

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

interface ProductFixture {
  id: string;
  name: string;
  description: string;
  slug: string;
  price: number;
  stock: number;
  stock_quantity: number;
  manage_stock: boolean;
  has_condition_offers?: boolean | null;
  average_rating?: number | null;
  review_count?: number | null;
  canonical_url?: string | null;
  category?: string | null;
  category_slug?: string | null;
  categories?: { name?: string | null; slug?: string | null } | null;
  product_categories?: Array<{
    categories?: { name?: string | null; slug?: string | null } | null;
  }> | null;
  created_at?: string | null;
  variants: Array<{
    id: string;
    attributes: Record<string, string>;
    stock_quantity: number;
    sku: string;
    primary_image: string;
  }>;
}

interface ReviewFixture {
  product_id: string | null;
  rating: number | string | null;
}

interface OfferFixture {
  id: string;
  product_id: string;
  condition: string;
  price: number;
  images?: unknown;
}

interface ManifestFixture {
  product_id: string;
  variant_id?: string | null;
  verified_url: string | null;
  verified_format: string | null;
  status: string;
  is_primary: boolean;
  position: number;
}

let productsResult: { data: ProductFixture[] | null; error: unknown };
let nullCreatedAtProductsResult: {
  data: ProductFixture[] | null;
  error: unknown;
};
let manifestResult: { data: ManifestFixture[] | null; error: unknown };
let offersResult: { data: OfferFixture[] | null; error: unknown };
let reviewsResult: {
  count?: number | null;
  data: ReviewFixture[] | null;
  error: unknown;
};
let reviewPageResults: Array<{
  count?: number | null;
  data: ReviewFixture[] | null;
  error: unknown;
}>;
const mockProductSelect = vi.fn();
const mockProductsGt = vi.fn();
const mockProductsIs = vi.fn();
const mockProductsOr = vi.fn();
const mockProductsNot = vi.fn();
const mockProductsOrder = vi.fn();
const mockProductsLimit = vi.fn();
const mockManifestEq = vi.fn();
const mockManifestIn = vi.fn();
const mockManifestOrder = vi.fn();
const mockManifestRange = vi.fn();
const mockReviewSelect = vi.fn();
const mockReviewsIn = vi.fn();
const mockReviewsOrder = vi.fn();
const mockReviewsRange = vi.fn();
let productQueryMode: 'non_null' | 'null' = 'non_null';

function createMockSupabase() {
  return {
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: mockProductSelect.mockImplementation(() => {
            const query = {
              eq: () => query,
              not: (column: string, operator: string, value: unknown) => {
                productQueryMode = 'non_null';
                mockProductsNot(column, operator, value);
                return query;
              },
              is: (column: string, value: unknown) => {
                if (column === 'created_at' && value === null) {
                  productQueryMode = 'null';
                }
                mockProductsIs(column, value);
                return query;
              },
              gt: (column: string, value: string) => {
                mockProductsGt(column, value);
                return query;
              },
              or: (filter: string) => {
                mockProductsOr(filter);
                return query;
              },
              order: (
                column: string,
                options?: {
                  ascending: boolean;
                }
              ) => {
                mockProductsOrder(column, options);
                return query;
              },
              limit: (value: number) => mockProductsLimit(value),
            };
            return query;
          }),
        };
      }
      if (table === 'product_reviews') {
        return {
          select: mockReviewSelect.mockImplementation(() => {
            const query = {
              eq: () => query,
              in: (column: string, values: string[]) => {
                mockReviewsIn(column, values);
                return query;
              },
              order: (
                column: string,
                options?: {
                  ascending: boolean;
                }
              ) => {
                mockReviewsOrder(column, options);
                return query;
              },
              range: (from: number, to: number) => mockReviewsRange(from, to),
            };
            return query;
          }),
        };
      }
      if (table === 'product_offers') {
        return {
          select: () => ({
            in: () => ({
              eq: () => Promise.resolve(offersResult),
            }),
          }),
        };
      }
      if (table === 'product_feed_images') {
        return {
          select: () => {
            const query = {
              eq: (column: string, value: unknown) => {
                mockManifestEq(column, value);
                return query;
              },
              in: (column: string, values: string[]) => {
                mockManifestIn(column, values);
                return query;
              },
              order: (
                column: string,
                options?: {
                  ascending: boolean;
                }
              ) => {
                mockManifestOrder(column, options);
                return query;
              },
              range: (from: number, to: number) => mockManifestRange(from, to),
            };
            return query;
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProductSelect.mockReset();
  mockProductsOr.mockReset();
  mockProductsNot.mockReset();
  mockProductsIs.mockReset();
  mockProductsGt.mockReset();
  mockProductsOrder.mockReset();
  mockProductsLimit.mockReset();
  mockManifestEq.mockReset();
  mockManifestIn.mockReset();
  mockManifestOrder.mockReset();
  mockManifestRange.mockReset();
  mockReviewSelect.mockReset();
  mockReviewsIn.mockReset();
  mockReviewsOrder.mockReset();
  mockReviewsRange.mockReset();
  productQueryMode = 'non_null';
  mockProductsLimit.mockImplementation(() =>
    Promise.resolve(
      productQueryMode === 'null' ? nullCreatedAtProductsResult : productsResult
    )
  );
  productsResult = {
    data: [
      {
        id: 'prod-1',
        name: 'Test Phone',
        created_at: '2026-01-01T00:00:00.000Z',
        description: 'A phone',
        slug: 'test-phone',
        price: 50000,
        stock: 5,
        stock_quantity: 5,
        manage_stock: true,
        variants: [
          {
            id: 'var-1',
            attributes: { color: 'Red' },
            stock_quantity: 3,
            sku: 'SKU-RED',
            primary_image: 'https://cdn.example.com/red.jpg',
          },
        ],
      },
    ],
    error: null,
  };
  nullCreatedAtProductsResult = { data: [], error: null };
  manifestResult = {
    data: [
      {
        product_id: 'prod-1',
        verified_url: 'https://cdn.example.com/manifest-front.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: true,
        position: 0,
      },
      {
        product_id: 'prod-1',
        variant_id: 'var-1',
        verified_url: 'https://cdn.example.com/manifest-red.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: true,
        position: 1,
      },
    ],
    error: null,
  };
  reviewsResult = { data: [], error: null };
  offersResult = { data: [], error: null };
  reviewPageResults = [];
  mockManifestRange.mockImplementation(() => Promise.resolve(manifestResult));
  mockReviewsRange.mockImplementation(() =>
    Promise.resolve(reviewPageResults.shift() ?? reviewsResult)
  );
  mockCreateAnonClient.mockReturnValue(createMockSupabase());
});

describe('getCachedOpenAIFeedData', () => {
  it('attaches offers for products flagged with condition offers', async () => {
    productsResult = {
      data: [
        {
          id: 'prod-1',
          name: 'Test Phone',
          created_at: '2026-01-01T00:00:00.000Z',
          description: 'A phone',
          slug: 'test-phone',
          price: 50000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          has_condition_offers: true,
          variants: [],
        },
      ],
      error: null,
    };
    offersResult = {
      data: [
        {
          id: 'offer-1',
          product_id: 'prod-1',
          condition: 'used',
          price: 40000,
          images: ['https://cdn.example.com/offer-used.jpg'],
        },
      ],
      error: null,
    };
    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1');

    expect(result.products).toHaveLength(1);
    expect(result.products[0].offers).toEqual([
      { images: ['https://cdn.example.com/offer-used.jpg'] },
    ]);
  });

  it('returns products with correct shape including manage_stock and variants', async () => {
    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1');

    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toEqual(
      expect.objectContaining({
        id: 'prod-1',
        name: 'Test Phone',
        manage_stock: true,
        stock_quantity: 5,
      })
    );
    expect(result.products[0].variants).toHaveLength(1);
    expect(result.products[0].variants?.[0]).toEqual(
      expect.objectContaining({
        id: 'var-1',
        attributes: { color: 'Red' },
        stock_quantity: 3,
        sku: 'SKU-RED',
      })
    );
    expect(mockProductSelect).toHaveBeenCalledWith(
      expect.stringContaining(
        'variants:product_variants!product_variants_product_id_fkey('
      )
    );
    expect(mockReviewSelect).not.toHaveBeenCalled();
    expect(mockReviewsIn).not.toHaveBeenCalled();
  });

  it('returns a verified feed image manifest for active products', async () => {
    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1');

    expect(mockManifestEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mockManifestEq).toHaveBeenCalledWith('status', 'verified');
    expect(mockManifestIn).toHaveBeenCalledWith('product_id', ['prod-1']);
    expect(mockManifestOrder).toHaveBeenCalledWith('product_id', {
      ascending: true,
    });
    expect(mockManifestOrder).toHaveBeenCalledWith('position', {
      ascending: true,
    });
    expect(mockManifestOrder).toHaveBeenCalledWith('id', { ascending: true });
    expect(result.imageManifest?.['prod-1']).toEqual([
      {
        variant_id: null,
        verified_url: 'https://cdn.example.com/manifest-front.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: true,
        position: 0,
      },
      {
        variant_id: 'var-1',
        verified_url: 'https://cdn.example.com/manifest-red.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: true,
        position: 1,
      },
    ]);
  });

  it('throws when the feed image manifest query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    manifestResult = {
      data: null,
      error: { message: 'manifest unavailable' },
    };

    const { getCachedOpenAIFeedData } = await import('./feed-data');

    await expect(getCachedOpenAIFeedData('merchant-1')).rejects.toThrow(
      'Failed to fetch image manifest'
    );
    expect(mockManifestEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mockManifestEq).toHaveBeenCalledWith('status', 'verified');
    expect(mockManifestIn).toHaveBeenCalledWith('product_id', ['prod-1']);
    expect(consoleSpy).toHaveBeenCalledWith(
      'DB_IMAGE_MANIFEST_ERROR:',
      expect.objectContaining({
        error: expect.objectContaining({ message: 'manifest unavailable' }),
        merchantId: 'merchant-1',
      })
    );
    consoleSpy.mockRestore();
  });

  it('selects canonical URL and joined category fields without reading a missing category_slug column', async () => {
    const { getCachedOpenAIFeedData } = await import('./feed-data');

    await getCachedOpenAIFeedData('merchant-1');

    const selectFragment = mockProductSelect.mock.calls[0]?.[0];
    expect(typeof selectFragment).toBe('string');
    if (typeof selectFragment !== 'string') {
      throw new Error('Expected products select fragment to be a string');
    }
    expect(selectFragment).toContain('canonical_url');
    expect(selectFragment).toContain('categories:category_id(name, slug)');
    expect(selectFragment).toContain(
      'product_categories(categories(name, slug))'
    );
    expect(selectFragment).not.toContain('category_slug');
  });

  it('prefers direct category_id relation over product_categories for canonical URL parity', async () => {
    productsResult = {
      data: [
        {
          id: 'prod-1',
          name: 'Test Phone',
          created_at: '2026-01-01T00:00:00.000Z',
          description: 'A phone',
          slug: 'test-phone',
          price: 50000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          category: 'Legacy Phones',
          categories: { name: 'Legacy Phones', slug: 'legacy-phones' },
          product_categories: [
            {
              categories: { name: 'Phones', slug: 'phones' },
            },
          ],
          variants: [],
        },
      ],
      error: null,
    };
    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1');

    expect(result.products[0]).toMatchObject({
      category: 'Legacy Phones',
      category_slug: 'legacy-phones',
      categories: { name: 'Legacy Phones', slug: 'legacy-phones' },
    });
    expect(result.products[0]).not.toHaveProperty('product_categories');
  });

  it('returns empty products array when no products exist', async () => {
    productsResult = { data: [], error: null };
    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1');

    expect(result.products).toEqual([]);
  });

  it('paginates products with a stable cursor beyond the first Supabase page', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `prod-${index}`,
      name: `Phone ${index}`,
      created_at: '2026-01-01T00:00:00.000Z',
      description: 'A phone',
      slug: `phone-${index}`,
      price: 50000,
      stock: 5,
      stock_quantity: 5,
      manage_stock: true,
      variants: [],
    }));
    mockProductsLimit
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'prod-1000',
            name: 'Phone 1000',
            created_at: '2026-01-01T00:00:00.000Z',
            description: 'A phone',
            slug: 'phone-1000',
            price: 50000,
            stock: 5,
            stock_quantity: 5,
            manage_stock: true,
            variants: [],
          },
        ],
        error: null,
      });

    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1');

    expect(mockProductsLimit).toHaveBeenCalledTimes(3);
    expect(mockProductsLimit).toHaveBeenNthCalledWith(1, 1000);
    expect(mockProductsLimit).toHaveBeenNthCalledWith(2, 1000);
    expect(mockProductsOr).toHaveBeenCalledWith(
      'created_at.lt.2026-01-01T00:00:00.000Z,and(created_at.eq.2026-01-01T00:00:00.000Z,id.gt.prod-999)'
    );
    expect(mockProductsIs).toHaveBeenCalledWith('created_at', null);
    expect(mockProductsOrder).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(mockProductsOrder).toHaveBeenCalledWith('id', { ascending: true });
    expect(result.products).toHaveLength(1001);
  });

  it('continues pagination across null created_at pages', async () => {
    productsResult = { data: [], error: null };
    const nullFullPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `prod-${index}`,
      name: `Phone ${index}`,
      created_at: null,
      description: 'A phone',
      slug: `phone-${index}`,
      price: 50000,
      stock: 5,
      stock_quantity: 5,
      manage_stock: true,
      variants: [],
    }));
    mockProductsLimit
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: nullFullPage, error: null })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'prod-1000',
            name: 'Phone 1000',
            created_at: null,
            description: 'A phone',
            slug: 'phone-1000',
            price: 50000,
            stock: 5,
            stock_quantity: 5,
            manage_stock: true,
            variants: [],
          },
        ],
        error: null,
      });

    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1');

    expect(mockProductsLimit).toHaveBeenCalledTimes(3);
    expect(mockProductsIs).toHaveBeenCalledWith('created_at', null);
    expect(mockProductsGt).toHaveBeenCalledWith('id', 'prod-999');
    expect(result.products).toHaveLength(1001);
  });

  it('throws and logs when products query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    productsResult = {
      data: null,
      error: { message: 'connection error' },
    };
    const { getCachedOpenAIFeedData } = await import('./feed-data');

    await expect(getCachedOpenAIFeedData('merchant-1')).rejects.toThrow(
      'Failed to fetch products'
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      'DB_PRODUCTS_ERROR:',
      expect.objectContaining({
        error: expect.objectContaining({ message: 'connection error' }),
        merchantId: 'merchant-1',
        cursor: null,
      })
    );
    consoleSpy.mockRestore();
  });

  it('hydrates review_count and average_rating from approved review rows', async () => {
    productsResult = {
      data: [
        {
          id: 'prod-1',
          name: 'Test Phone',
          created_at: '2026-01-01T00:00:00.000Z',
          description: 'A phone',
          slug: 'test-phone',
          price: 50000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          variants: [],
        },
      ],
      error: null,
    };
    reviewsResult = {
      data: [
        { product_id: 'prod-1', rating: 4 },
        { product_id: 'prod-1', rating: 5 },
      ],
      error: null,
    };

    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1', true);

    expect(mockReviewSelect).toHaveBeenCalledWith('product_id, rating', {
      count: 'exact',
    });
    expect(mockReviewsIn).toHaveBeenCalledWith('product_id', ['prod-1']);
    expect(mockReviewsOrder).toHaveBeenNthCalledWith(1, 'product_id', {
      ascending: true,
    });
    expect(mockReviewsOrder).toHaveBeenNthCalledWith(2, 'id', {
      ascending: true,
    });
    expect(mockReviewsRange).toHaveBeenCalledWith(0, 999);
    expect(result.products[0]).toMatchObject({
      average_rating: 4.5,
      review_count: 2,
    });
  });

  it('paginates approved review rows before aggregating review signals', async () => {
    productsResult = {
      data: [
        {
          id: 'prod-1',
          name: 'Test Phone',
          created_at: '2026-01-01T00:00:00.000Z',
          description: 'A phone',
          slug: 'test-phone',
          price: 50000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          variants: [],
        },
      ],
      error: null,
    };
    reviewPageResults = [
      {
        data: Array.from({ length: 1000 }, () => ({
          product_id: 'prod-1',
          rating: 4,
        })),
        error: null,
      },
      {
        data: [{ product_id: 'prod-1', rating: 5 }],
        error: null,
      },
    ];

    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1', true);

    expect(mockReviewSelect).toHaveBeenNthCalledWith(1, 'product_id, rating', {
      count: 'exact',
    });
    expect(mockReviewSelect).toHaveBeenNthCalledWith(2, 'product_id, rating');
    expect(mockReviewsRange).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockReviewsRange).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(mockReviewsOrder).toHaveBeenCalledTimes(4);
    expect(result.products[0]).toMatchObject({
      average_rating: 4,
      review_count: 1001,
    });
  });

  it('continues paging when the server caps review rows below the requested page size', async () => {
    productsResult = {
      data: [
        {
          id: 'prod-1',
          name: 'Test Phone',
          created_at: '2026-01-01T00:00:00.000Z',
          description: 'A phone',
          slug: 'test-phone',
          price: 50000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          variants: [],
        },
      ],
      error: null,
    };
    reviewPageResults = [
      {
        count: 5,
        data: [
          { product_id: 'prod-1', rating: 4 },
          { product_id: 'prod-1', rating: 4 },
        ],
        error: null,
      },
      {
        count: 5,
        data: [
          { product_id: 'prod-1', rating: 4 },
          { product_id: 'prod-1', rating: 4 },
        ],
        error: null,
      },
      {
        count: 5,
        data: [{ product_id: 'prod-1', rating: 5 }],
        error: null,
      },
    ];

    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1', true);

    expect(mockReviewSelect).toHaveBeenNthCalledWith(1, 'product_id, rating', {
      count: 'exact',
    });
    expect(mockReviewSelect).toHaveBeenNthCalledWith(2, 'product_id, rating');
    expect(mockReviewSelect).toHaveBeenNthCalledWith(3, 'product_id, rating');
    expect(mockReviewsRange).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockReviewsRange).toHaveBeenNthCalledWith(2, 2, 1001);
    expect(mockReviewsRange).toHaveBeenNthCalledWith(3, 4, 1003);
    expect(mockReviewsOrder).toHaveBeenCalledTimes(6);
    expect(result.products[0]).toMatchObject({
      average_rating: 4.2,
      review_count: 5,
    });
  });

  it('drops blank, null, non-finite, and out-of-range review ratings', async () => {
    productsResult = {
      data: [
        {
          id: 'prod-1',
          name: 'Test Phone',
          created_at: '2026-01-01T00:00:00.000Z',
          description: 'A phone',
          slug: 'test-phone',
          price: 50000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          variants: [],
        },
      ],
      error: null,
    };
    reviewPageResults = [
      {
        data: [
          { product_id: 'prod-1', rating: '4' },
          { product_id: 'prod-1', rating: '' },
          { product_id: 'prod-1', rating: null },
          { product_id: 'prod-1', rating: 6 },
          { product_id: 'prod-1', rating: 'not-a-number' },
        ],
        error: null,
      },
    ];

    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1', true);

    expect(mockReviewsOrder).toHaveBeenNthCalledWith(1, 'product_id', {
      ascending: true,
    });
    expect(mockReviewsOrder).toHaveBeenNthCalledWith(2, 'id', {
      ascending: true,
    });
    expect(mockReviewsRange).toHaveBeenCalledWith(0, 999);
    expect(result.products[0]).toMatchObject({
      average_rating: 4,
      review_count: 1,
    });
  });

  it('marks review signals unknown when review hydration fails', async () => {
    productsResult = {
      data: [
        {
          id: 'prod-1',
          name: 'Test Phone',
          created_at: '2026-01-01T00:00:00.000Z',
          description: 'A phone',
          slug: 'test-phone',
          price: 50000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          average_rating: 4.8,
          review_count: 18,
          variants: [],
        },
      ],
      error: null,
    };
    reviewsResult = {
      data: null,
      error: { message: 'reviews unavailable' },
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1', true);

    expect(result.products[0]).toMatchObject({
      average_rating: null,
      review_count: null,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'DB_REVIEW_SIGNAL_WARNING:',
      expect.objectContaining({
        merchantId: 'merchant-1',
        productCount: 1,
      })
    );
    warnSpy.mockRestore();
  });
});
