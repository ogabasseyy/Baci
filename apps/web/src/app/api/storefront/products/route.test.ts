const listingVariants = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/lib/cached-data', () => ({
  getPublicProductVariantsByProductIds: listingVariants,
}));

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontProductsRouteTestHarness } from './route.test-helpers';

vi.mock('@supabase/supabase-js', () => ({
  createClient: storefrontProductsRouteTestHarness.mockCreateStaticClient,
}));

vi.mock('next/cache', () => ({
  unstable_cache:
    <T extends (...args: never[]) => Promise<unknown>>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/env', () => ({
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseUrl: vi.fn(() => 'https://example.supabase.co'),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: storefrontProductsRouteTestHarness.mockCreateServerClient,
}));

import { GET } from './route';

describe('GET /api/storefront/products validation', () => {
  beforeEach(() => {
    storefrontProductsRouteTestHarness.reset();
  });

  it('returns 400 when merchant_id is missing', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/storefront/products')
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Merchant ID is required');
  });

  it('logs invalid query parameters as client warnings', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());

    try {
      const response = await GET(
        new NextRequest(
          'http://localhost/api/storefront/products?merchant_id=not-a-uuid'
        )
      );
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toBe('Invalid parameters');
      expect(warnSpy).toHaveBeenCalledWith(
        'API Validation Failed:',
        expect.stringContaining('Invalid uuid')
      );
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('GET /api/storefront/products cached filter execution', () => {
  beforeEach(() => {
    storefrontProductsRouteTestHarness.reset();
  });

  it('paginates limited category filters instead of broad-scanning every active product', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      {
        data: Array.from({ length: 48 }, (_, index) =>
          storefrontProductsRouteTestHarness.createRawProduct({
            id: `laptop-${index}`,
            category: 'Laptops',
            categories: { id: 'cat-laptops', name: 'Laptops', slug: 'laptops' },
            name: `Laptop ${index}`,
            slug: `laptop-${index}`,
          })
        ),
        error: null,
      },
      {
        data: [
          storefrontProductsRouteTestHarness.createRawProduct({
            id: 'phone-1',
            category: 'Smartphones',
            categories: {
              id: 'cat-smartphones',
              name: 'Smartphones',
              slug: 'smartphones',
            },
            name: 'Phone 1',
            slug: 'phone-1',
          }),
          storefrontProductsRouteTestHarness.createRawProduct({
            id: 'phone-2',
            category: 'Smartphones',
            categories: {
              id: 'cat-smartphones',
              name: 'Smartphones',
              slug: 'smartphones',
            },
            name: 'Phone 2',
            slug: 'phone-2',
          }),
        ],
        error: null,
      },
    ];

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&category=smartphones&limit=2&compact=true&has_images=true`
      )
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'phone-1',
      'phone-2',
    ]);
    const queries =
      storefrontProductsRouteTestHarness.mockProductsQueries.current;
    expect(queries).toHaveLength(2);
    expect(queries[0]?.limit).not.toHaveBeenCalled();
    expect(queries[1]?.limit).not.toHaveBeenCalled();
    expect(queries[0]?.range).toHaveBeenCalledWith(0, 47);
    expect(queries[1]?.range).toHaveBeenCalledWith(48, 95);
    expect(queries[0]?.order).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: false,
    });
    expect(queries[0]?.order).toHaveBeenNthCalledWith(2, 'id', {
      ascending: true,
    });
  });

  it('continues sparse category scans past 1000 candidates until the requested page is filled', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      ...Array.from({ length: 5 }, (_, pageIndex) => ({
        data: Array.from({ length: 200 }, (_, index) =>
          storefrontProductsRouteTestHarness.createRawProduct({
            id: `laptop-${pageIndex}-${index}`,
            category: 'Laptops',
            categories: { id: 'cat-laptops', name: 'Laptops', slug: 'laptops' },
            name: `Laptop ${pageIndex}-${index}`,
            slug: `laptop-${pageIndex}-${index}`,
          })
        ),
        error: null,
      })),
      {
        data: [
          storefrontProductsRouteTestHarness.createRawProduct({
            id: 'phone-after-1000',
            category: 'Smartphones',
            categories: {
              id: 'cat-smartphones',
              name: 'Smartphones',
              slug: 'smartphones',
            },
            name: 'Phone after 1000',
            slug: 'phone-after-1000',
          }),
        ],
        error: null,
      },
    ];

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&category=smartphones&limit=50&compact=true`
      )
    );

    const body = await response.json();
    const queries =
      storefrontProductsRouteTestHarness.mockProductsQueries.current;
    expect(response.status).toBe(200);
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'phone-after-1000',
    ]);
    expect(queries).toHaveLength(6);
    expect(queries[5]?.range).toHaveBeenCalledWith(1000, 1199);
  });

  it('uses bounded pagination for category filters even when no limit is provided', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      {
        data: Array.from({ length: 200 }, (_, index) =>
          storefrontProductsRouteTestHarness.createRawProduct({
            id: `laptop-${index}`,
            category: 'Laptops',
            categories: { id: 'cat-laptops', name: 'Laptops', slug: 'laptops' },
            name: `Laptop ${index}`,
            slug: `laptop-${index}`,
          })
        ),
        error: null,
      },
      {
        data: [
          storefrontProductsRouteTestHarness.createRawProduct({
            id: 'phone-1',
            category: 'Smartphones',
            categories: {
              id: 'cat-smartphones',
              name: 'Smartphones',
              slug: 'smartphones',
            },
            name: 'Phone 1',
            slug: 'phone-1',
          }),
        ],
        error: null,
      },
    ];

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&category=smartphones&compact=true`
      )
    );

    const body = await response.json();
    const queries =
      storefrontProductsRouteTestHarness.mockProductsQueries.current;
    expect(response.status).toBe(200);
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'phone-1',
    ]);
    expect(queries).toHaveLength(2);
    expect(queries[0]?.limit).not.toHaveBeenCalled();
    expect(queries[0]?.range).toHaveBeenCalledWith(0, 199);
    expect(queries[1]?.range).toHaveBeenCalledWith(200, 399);
  });

  it('paginates limited condition filters because the database prefilter is an approximate superset', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      {
        data: Array.from({ length: 48 }, (_, index) =>
          storefrontProductsRouteTestHarness.createRawProduct({
            id: `new-${index}`,
            name: `New Device ${index}`,
            slug: `new-${index}`,
            condition: 'new',
            available_conditions: ['new'],
            has_condition_offers: true,
          })
        ),
        error: null,
      },
      {
        data: [
          storefrontProductsRouteTestHarness.createRawProduct({
            id: 'used-1',
            name: 'Used Device 1',
            slug: 'used-device-1',
            condition: 'used',
            available_conditions: ['used'],
            has_condition_offers: false,
          }),
        ],
        error: null,
      },
    ];

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&condition=used&limit=1&compact=true`
      )
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'used-1',
    ]);
    const queries =
      storefrontProductsRouteTestHarness.mockProductsQueries.current;
    expect(queries).toHaveLength(2);
    expect(queries[0]?.limit).not.toHaveBeenCalled();
    expect(queries[0]?.range).toHaveBeenCalledWith(0, 47);
    expect(queries[1]?.range).toHaveBeenCalledWith(48, 95);
  });

  it('returns 500 when a chunked product fetch fails', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      {
        data: [],
        error: { message: 'statement timeout' },
      },
    ];

    try {
      const response = await GET(
        new NextRequest(
          `http://localhost/api/storefront/products?merchant_id=${merchantId}&category=smartphones&limit=2`
        )
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(errorSpy).toHaveBeenCalledWith(
        'Unexpected error in GET /api/storefront/products:',
        expect.objectContaining({ merchantId })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns an empty product list when a bounded category page has no matches', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      {
        data: Array.from({ length: 3 }, (_, index) =>
          storefrontProductsRouteTestHarness.createRawProduct({
            id: `laptop-${index}`,
            category: 'Laptops',
            categories: { id: 'cat-laptops', name: 'Laptops', slug: 'laptops' },
            name: `Laptop ${index}`,
            slug: `laptop-${index}`,
          })
        ),
        error: null,
      },
    ];

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&category=smartphones&limit=2`
      )
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.products).toEqual([]);
    expect(
      storefrontProductsRouteTestHarness.mockProductsQueries.current
    ).toHaveLength(1);
  });

  it('stops after the first short page when enough filtered products are found', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      {
        data: [
          storefrontProductsRouteTestHarness.createRawProduct({
            id: 'phone-1',
            category: 'Smartphones',
            categories: {
              id: 'cat-smartphones',
              name: 'Smartphones',
              slug: 'smartphones',
            },
            name: 'Phone 1',
            slug: 'phone-1',
          }),
        ],
        error: null,
      },
    ];

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&category=smartphones&limit=1`
      )
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'phone-1',
    ]);
    expect(
      storefrontProductsRouteTestHarness.mockProductsQueries.current
    ).toHaveLength(1);
  });

  it('stops sparse in-memory filter scans only after the database range is exhausted', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      ...Array.from({ length: 20 }, (_, pageIndex) => ({
        data: Array.from({ length: 48 }, (_, productIndex) =>
          storefrontProductsRouteTestHarness.createRawProduct({
            id: `laptop-${pageIndex}-${productIndex}`,
            category: 'Laptops',
            categories: { id: 'cat-laptops', name: 'Laptops', slug: 'laptops' },
            name: `Laptop ${pageIndex}-${productIndex}`,
            slug: `laptop-${pageIndex}-${productIndex}`,
          })
        ),
        error: null,
      })),
      {
        data: Array.from({ length: 40 }, (_, productIndex) =>
          storefrontProductsRouteTestHarness.createRawProduct({
            id: `laptop-final-${productIndex}`,
            category: 'Laptops',
            categories: { id: 'cat-laptops', name: 'Laptops', slug: 'laptops' },
            name: `Laptop final ${productIndex}`,
            slug: `laptop-final-${productIndex}`,
          })
        ),
        error: null,
      },
    ];

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&category=smartphones&limit=1`
      )
    );

    const body = await response.json();
    const queries =
      storefrontProductsRouteTestHarness.mockProductsQueries.current;
    expect(response.status).toBe(200);
    expect(body.products).toEqual([]);
    expect(queries).toHaveLength(21);
    expect(queries.at(-1)?.range).toHaveBeenCalledWith(960, 1007);
  });
});

describe('standard listing cellular phone prices', () => {
  beforeEach(() => {
    storefrontProductsRouteTestHarness.reset();
    listingVariants.mockReset();
  });
  it('renders the eligible cellular price and retains the existing options-selection guard', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const phone = storefrontProductsRouteTestHarness.createRawProduct({
      id: 'iphone16',
      name: 'iPhone 16',
      category: 'Smartphones',
      price: 600000,
      has_variants: true,
      variant_model: 'sku_matrix',
      manage_stock: false,
    });
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      { data: [phone], error: null },
    ];
    listingVariants.mockResolvedValue({
      iphone16: [
        {
          id: 'wifi',
          product_id: 'iphone16',
          attributes: { sim_type: 'Wi-Fi Only' },
          price_override: 600000,
          condition: 'used',
          stock_quantity: 0,
        },
        {
          id: 'cellular',
          product_id: 'iphone16',
          attributes: { sim_type: 'Physical + eSIM' },
          price_override: 900000,
          condition: 'new',
          stock_quantity: 0,
        },
      ],
    });
    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&limit=1`
      )
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.select
    ).toHaveBeenCalledWith(
      expect.stringMatching(/\bhas_variants\b[\s\S]*\bvariant_model\b/)
    );
    expect(body.products[0]).toMatchObject({
      price: 900000,
      condition: 'new',
      has_variants: true,
    });
    expect(body.products[0]).not.toHaveProperty('variants');
    expect(listingVariants).toHaveBeenCalledExactlyOnceWith(merchantId, [
      'iphone16',
    ]);
    expect(phone.price).toBe(600000);
  });

  it('broadens price candidate selection so phone family with parent price below min_price is included when its cellular variant matches', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const phone = storefrontProductsRouteTestHarness.createRawProduct({
      id: 'iphone16',
      name: 'iPhone 16',
      category: 'Smartphones',
      price: 600000,
      has_variants: true,
      variant_model: 'sku_matrix',
      manage_stock: false,
    });
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      { data: [phone], error: null },
    ];
    listingVariants.mockResolvedValue({
      iphone16: [
        {
          id: 'cellular',
          product_id: 'iphone16',
          attributes: { sim_type: 'Physical + eSIM' },
          price_override: 900000,
          condition: 'new',
          stock_quantity: 0,
        },
      ],
    });

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&min_price=800000&limit=1`
      )
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.or
    ).toHaveBeenCalledWith(
      expect.stringContaining(
        'has_variants.eq.true,variant_model.eq.sku_matrix'
      )
    );
    expect(body.products).toHaveLength(1);
    expect(body.products[0]).toMatchObject({
      id: 'iphone16',
      price: 900000,
    });
  });

  it('sorts projected cellular variant prices for price-asc', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const phoneCheapParent =
      storefrontProductsRouteTestHarness.createRawProduct({
        id: 'phone-cheap',
        name: 'iPhone Cheap Parent',
        category: 'Smartphones',
        price: 400000,
        has_variants: true,
        variant_model: 'sku_matrix',
        manage_stock: false,
      });
    const phoneExpensiveParent =
      storefrontProductsRouteTestHarness.createRawProduct({
        id: 'phone-expensive',
        name: 'iPhone Expensive Parent',
        category: 'Smartphones',
        price: 900000,
        has_variants: true,
        variant_model: 'sku_matrix',
        manage_stock: false,
      });
    storefrontProductsRouteTestHarness.mockProductsResults.current = [
      { data: [phoneCheapParent, phoneExpensiveParent], error: null },
    ];
    listingVariants.mockResolvedValue({
      'phone-cheap': [
        {
          id: 'var-1',
          product_id: 'phone-cheap',
          attributes: { sim_type: 'Physical + eSIM' },
          price_override: 750000,
          condition: 'new',
          stock_quantity: 2,
        },
      ],
      'phone-expensive': [
        {
          id: 'var-2',
          product_id: 'phone-expensive',
          attributes: { sim_type: 'Physical + eSIM' },
          price_override: 500000,
          condition: 'new',
          stock_quantity: 2,
        },
      ],
    });

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&sort=price-asc&limit=2`
      )
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.products.map((p: { id: string }) => p.id)).toEqual([
      'phone-expensive',
      'phone-cheap',
    ]);
    expect(body.products.map((p: { price: number }) => p.price)).toEqual([
      500000, 750000,
    ]);
  });

  it('subtracts dropped phone families from dbCount on ranked search when no in-memory filters are active', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const restrictedPhone = storefrontProductsRouteTestHarness.createRawProduct(
      {
        id: 'phone-restricted',
        name: 'iPhone Restricted',
        category: 'Smartphones',
        price: 600000,
        has_variants: true,
        variant_model: 'sku_matrix',
        manage_stock: false,
      }
    );
    const regularProduct = storefrontProductsRouteTestHarness.createRawProduct({
      id: 'product-regular',
      name: 'iPhone Charger',
      category: 'Accessories',
      price: 25000,
      has_variants: false,
      manage_stock: false,
    });

    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [
          { product_id: 'phone-restricted', total_count: 2 },
          { product_id: 'product-regular', total_count: 2 },
        ],
        error: null,
      }
    );

    storefrontProductsRouteTestHarness.mockProductsByIdsResult.current = {
      data: [restrictedPhone, regularProduct],
      error: null,
    };

    listingVariants.mockResolvedValue({
      'phone-restricted': [
        {
          id: 'wifi',
          product_id: 'phone-restricted',
          attributes: { sim_type: 'Wi-Fi Only' },
          price_override: 600000,
          condition: 'used',
        },
      ],
    });

    const response = await GET(
      new NextRequest(
        `http://localhost/api/storefront/products?merchant_id=${merchantId}&q=iphone&limit=2`
      )
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.products.map((p: { id: string }) => p.id)).toEqual([
      'product-regular',
    ]);
    expect(body.count).toBe(1);
    expect(body.pagination.totalCount).toBe(1);
    expect(body.pagination.hasMore).toBe(false);
  });
});
