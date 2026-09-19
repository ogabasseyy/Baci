import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateAnonClient = vi.fn();

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => mockCreateAnonClient(),
}));

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import {
  createMockSupabase,
  harness,
  mockManifestEq,
  mockManifestIn,
  mockManifestOrder,
  mockProductSelect,
  mockProductsGt,
  mockProductsIs,
  mockProductsLimit,
  mockProductsOr,
  mockProductsOrder,
  mockReviewSelect,
  mockReviewsIn,
  mockReviewsOrder,
  mockReviewsRange,
  resetFeedDataHarness,
} from './feed-data.test-helpers';

beforeEach(() => {
  resetFeedDataHarness();
  mockCreateAnonClient.mockReturnValue(createMockSupabase());
});

describe('getCachedOpenAIFeedData', () => {
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
        source_url: null,
        verified_url: 'https://cdn.example.com/manifest-front.jpg',
        verified_format: 'jpeg',
        status: 'verified',
        is_primary: true,
        position: 0,
      },
      {
        variant_id: 'var-1',
        source_url: null,
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
    harness.manifestResult = {
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
    harness.productsResult = {
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
    harness.productsResult = { data: [], error: null };
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
    harness.productsResult = { data: [], error: null };
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
    harness.productsResult = {
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
    harness.productsResult = {
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
    harness.reviewsResult = {
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
    harness.productsResult = {
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
    harness.reviewPageResults = [
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
    harness.productsResult = {
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
    harness.reviewPageResults = [
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
    harness.productsResult = {
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
    harness.reviewPageResults = [
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
    harness.productsResult = {
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
    harness.reviewsResult = {
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
