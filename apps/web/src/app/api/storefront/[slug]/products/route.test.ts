import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateStaticClient,
  mockProductSelect,
  mockProductNot,
  mockProductLimit,
  mockMerchantSingle,
  mockProductOrder,
} = vi.hoisted(() => {
  const mockMerchantSingle = vi.fn();
  const mockProductLimit = vi.fn();
  const mockProductNot = vi.fn();
  const mockProductOrder = vi.fn();
  const productQuery = {
    eq: vi.fn(() => productQuery),
    not: mockProductNot,
    order: mockProductOrder,
  };
  mockProductNot.mockImplementation(() => productQuery);
  const mockProductSelect = vi.fn(() => productQuery);
  const mockCreateStaticClient = vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: mockMerchantSingle,
            })),
          })),
        };
      }

      if (table === 'products') {
        return {
          select: mockProductSelect,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  }));

  return {
    mockCreateStaticClient,
    mockProductSelect,
    mockProductNot,
    mockProductLimit,
    mockMerchantSingle,
    mockProductOrder,
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateStaticClient,
}));

vi.mock('next/cache', () => ({
  unstable_cache:
    <T extends (...args: never[]) => Promise<unknown>>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));

vi.mock('@/env', () => ({
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseUrl: vi.fn(() => 'https://example.supabase.co'),
}));

// Default: the slug is not a retired alias. Individual tests override for the
// retired-slug path (params.slug on /api/storefront/{oldSlug}/products).
const mockGetCurrentSlugForAlias = vi.fn().mockResolvedValue(null);
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: (...args: unknown[]) =>
    mockGetCurrentSlugForAlias(...args),
}));

vi.mock('@/lib/product-stock', () => ({
  getEffectiveStock: vi.fn(() => 7),
}));

import { GET } from './route';

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-123',
    name: 'Test Phone',
    description: 'Fast phone',
    price: 1000,
    compare_at_price: null,
    images: ['https://cdn.example.com/phone.jpg'],
    image_hint: 'phone',
    category: 'Phones',
    brand: 'Test',
    status: 'active',
    has_variants: false,
    slug: 'test-phone',
    sku: 'TP-123',
    manage_stock: false,
    stock: 0,
    stock_quantity: 0,
    low_stock_threshold: 2,
    color: 'Black',
    condition: 'new',
    ...overrides,
  };
}

function requestProducts(url: string, slug = 'test-store') {
  return GET(new NextRequest(url), { params: Promise.resolve({ slug }) });
}

describe('GET /api/storefront/[slug]/products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMerchantSingle.mockReset();
    mockProductOrder.mockReset();
    mockProductLimit.mockReset();
    mockProductNot.mockClear();
    mockProductSelect.mockClear();
  });

  it('returns 400 when the route slug is invalid', async () => {
    const response = await requestProducts(
      'https://example.com/api/storefront//products',
      ''
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid route parameters');
    expect(data.code).toBe('INVALID_PARAMS');
    expect(data.details.fieldErrors.slug).toEqual(
      expect.arrayContaining([expect.any(String)])
    );
    expect(mockMerchantSingle).not.toHaveBeenCalled();
    expect(mockProductOrder).not.toHaveBeenCalled();
  });

  it('maps string array images to storefront image fields', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockResolvedValue({
      data: [product({ manage_stock: null })],
      error: null,
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/test-store/products'
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.products).toEqual([
      expect.objectContaining({
        id: 'product-123',
        image: 'https://cdn.example.com/phone.jpg',
        imageLarge: 'https://cdn.example.com/phone.jpg',
        stock: 7,
        availability: 'in_stock',
        inventory_policy: 'untracked',
        is_purchasable: true,
        quantity_available: null,
        manage_stock: false,
      }),
    ]);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=1800, stale-while-revalidate=86400'
    );
  });

  it('resolves a RETIRED slug via the alias table for /api/storefront/{oldSlug}/products', async () => {
    // Stale client still calls the OLD slug in the PATH after a rename. The proxy
    // can't rewrite a path param, so the route resolves it through the alias table:
    // first lookup (old slug) misses, the alias resolves the current slug, retry hits.
    mockMerchantSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'merchant-123' }, error: null });
    mockGetCurrentSlugForAlias.mockResolvedValueOnce('new-store');
    mockProductOrder.mockResolvedValue({
      data: [product()],
      error: null,
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/old-store/products',
      'old-store'
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.products).toHaveLength(1);
    expect(mockGetCurrentSlugForAlias).toHaveBeenCalledWith('old-store');
  });

  it('defaults the public slug product API to the compact listing projection', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockResolvedValue({
      data: [product()],
      error: null,
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/test-store/products'
    );
    const selectArg = String(
      (mockProductSelect.mock.calls as unknown[][])[0]?.[0]
    );

    expect(response.status).toBe(200);
    expect(selectArg).not.toContain('description');
    expect(selectArg).toContain('has_variants');
    expect(selectArg).not.toContain('specifications');
    expect(selectArg).not.toContain('variant_attributes');
    expect(selectArg).not.toMatch(/\boffers\b/);
  });

  it('allows explicit full product projection for comparison-style callers', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockResolvedValue({
      data: [product()],
      error: null,
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/test-store/products?compact=false'
    );
    const selectArg = String(
      (mockProductSelect.mock.calls as unknown[][])[0]?.[0]
    );

    expect(response.status).toBe(200);
    expect(selectArg).toContain('specifications');
    expect(selectArg).toContain('variant_attributes');
  });

  it('applies the validated limit query to the products query', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockReturnValueOnce({
      limit: mockProductLimit,
    });
    mockProductLimit.mockResolvedValue({
      data: [
        product({
          id: 'product-1',
          name: 'First Phone',
          description: 'First product description',
          images: ['https://cdn.example.com/first.jpg'],
          image_hint: 'first phone',
          slug: 'first-phone',
          sku: 'FIRST-1',
        }),
        product({
          id: 'product-2',
          name: 'Second Phone',
          description: 'Second product description',
          price: 2000,
          images: ['https://cdn.example.com/second.jpg'],
          image_hint: 'second phone',
          slug: 'second-phone',
          sku: 'SECOND-2',
          color: 'Blue',
        }),
      ],
      error: null,
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/test-store/products?limit=2'
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockProductLimit).toHaveBeenCalledWith(2);
    expect(data.products).toHaveLength(2);
  });

  it('pushes image-presence filtering to the database when requested', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockResolvedValue({
      data: [product()],
      error: null,
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/test-store/products?has_images=true'
    );

    expect(response.status).toBe(200);
    expect(mockProductNot).toHaveBeenCalledWith('images->0', 'is', null);
  });

  it('preserves SKU-matrix selection metadata in the response', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockResolvedValue({
      data: [
        product({
          id: 'iphone-15',
          name: 'iPhone 15',
          has_variants: true,
          variant_model: 'sku_matrix',
          available_conditions: ['open_box', 'used'],
          has_condition_offers: true,
        }),
      ],
      error: null,
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/test-store/products'
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.products).toEqual([
      expect.objectContaining({
        id: 'iphone-15',
        has_variants: true,
        variant_model: 'sku_matrix',
        available_conditions: ['open_box', 'used'],
        has_condition_offers: true,
      }),
    ]);
  });

  it('uses joined category data for API/feed category parity', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockResolvedValue({
      data: [
        product({
          id: 'redmi-a7-pro',
          name: 'Redmi A7 Pro',
          category: 'General',
          categories: {
            id: 'cat-smartphones',
            name: 'Smartphones',
            slug: 'smartphones',
          },
          category_id: 'cat-smartphones',
          slug: 'redmi-a7-pro',
        }),
      ],
      error: null,
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/test-store/products'
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockProductSelect).toHaveBeenCalledWith(
      expect.stringContaining('categories:category_id(id, name, slug)')
    );
    expect(data.products).toEqual([
      expect.objectContaining({
        id: 'redmi-a7-pro',
        category: 'Smartphones',
      }),
    ]);
  });

  it('falls back through relation categories and legacy category text', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockResolvedValue({
      data: [
        product({
          id: 'relation-category-product',
          name: 'Relation Category Product',
          category: 'General',
          categories: null,
          product_categories: [
            {
              categories: {
                id: 'cat-featured',
                name: 'Featured Phones',
                slug: 'featured-phones',
              },
            },
          ],
        }),
        product({
          id: 'legacy-category-product',
          name: 'Legacy Category Product',
          category: 'Legacy Accessories',
          categories: null,
          product_categories: [],
        }),
        product({
          id: 'default-category-product',
          name: 'Default Category Product',
          category: '   ',
          categories: {},
          product_categories: [
            { categories: { name: '   ', slug: 'blank' } },
            { not_categories: { name: 'Ignored' } },
          ],
        }),
      ],
      error: null,
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/test-store/products'
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.products).toEqual([
      expect.objectContaining({
        id: 'relation-category-product',
        category: 'Featured Phones',
      }),
      expect.objectContaining({
        id: 'legacy-category-product',
        category: 'Legacy Accessories',
      }),
      expect.objectContaining({
        id: 'default-category-product',
        category: 'General',
      }),
    ]);
  });

  it.each([
    [
      'invalid',
      'https://example.com/api/storefront/test-store/products?limit=999',
      'limit',
    ],
    [
      'empty',
      'https://example.com/api/storefront/test-store/products?limit=',
      'limit',
    ],
    [
      'invalid compact flag',
      'https://example.com/api/storefront/test-store/products?compact=maybe',
      'compact',
    ],
  ])('returns 400 when the %s query is invalid', async (_label, url, field) => {
    const response = await requestProducts(url);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid query parameters');
    expect(data.code).toBe('INVALID_QUERY');
    expect(data.details.fieldErrors[field]).toEqual(
      expect.arrayContaining([expect.any(String)])
    );
    expect(mockMerchantSingle).not.toHaveBeenCalled();
    expect(mockProductOrder).not.toHaveBeenCalled();
  });

  it('does not leak the limit-chain mock into a later no-limit request', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockReturnValueOnce({
      limit: mockProductLimit,
    });
    mockProductLimit.mockResolvedValue({
      data: [],
      error: null,
    });

    const limitedResponse = await requestProducts(
      'https://example.com/api/storefront/test-store/products?limit=2'
    );

    mockProductOrder.mockResolvedValue({
      data: [
        product({
          id: 'product-after-limit',
          name: 'Fresh Product',
          description: 'Fresh product description',
          images: ['https://cdn.example.com/fresh.jpg'],
          image_hint: 'fresh phone',
          slug: 'fresh-product',
          sku: 'FRESH-1',
        }),
      ],
      error: null,
    });

    const noLimitResponse = await requestProducts(
      'https://example.com/api/storefront/test-store/products'
    );
    const data = await noLimitResponse.json();

    expect(limitedResponse.status).toBe(200);
    expect(noLimitResponse.status).toBe(200);
    expect(data.products).toEqual([
      expect.objectContaining({ id: 'product-after-limit' }),
    ]);
  });

  it('returns 404 when the merchant slug does not resolve', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: null,
      error: { message: 'Not found' },
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/missing-store/products',
      'missing-store'
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Store not found for slug: missing-store');
    expect(mockProductOrder).not.toHaveBeenCalled();
  });

  it('returns 500 when the products query fails', async () => {
    mockMerchantSingle.mockResolvedValue({
      data: { id: 'merchant-123' },
      error: null,
    });
    mockProductOrder.mockResolvedValue({
      data: null,
      error: { message: 'database exploded' },
    });

    const response = await requestProducts(
      'https://example.com/api/storefront/test-store/products'
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Internal server error');
    expect(mockMerchantSingle).toHaveBeenCalled();
    expect(mockProductOrder).toHaveBeenCalled();
  });
});
