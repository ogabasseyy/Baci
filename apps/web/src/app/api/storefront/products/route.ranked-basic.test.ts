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

const VALID_MERCHANT_ID = '00000000-0000-4000-8000-000000000001';

function createRequestUrl(query = '') {
  const params = new URLSearchParams({
    merchant_id: VALID_MERCHANT_ID,
  });

  if (query) {
    const extraParams = new URLSearchParams(query);
    for (const [key, value] of extraParams.entries()) {
      params.set(key, value);
    }
  }

  return `http://localhost/api/storefront/products?${params.toString()}`;
}

describe('GET /api/storefront/products ranked search basics', () => {
  beforeEach(() => {
    storefrontProductsRouteTestHarness.reset();
  });

  it('uses ranked storefront search when q is present', async () => {
    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [
          { product_id: 'product-2', total_count: 2 },
          { product_id: 'product-1', total_count: 2 },
        ],
        error: null,
      }
    );

    storefrontProductsRouteTestHarness.mockProductsByIdsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-1',
          name: 'iPhone X',
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-2',
          name: 'iPhone 16 Pro',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=iphnoe&limit=20'))
    );

    const body = await response.json();
    expect(
      storefrontProductsRouteTestHarness.mockSearchRpc.current
    ).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        search_query: 'iphnoe',
        sort_by: 'relevance',
      })
    );
    expect(
      storefrontProductsRouteTestHarness.mockProductsByIdsQuery.current?.in
    ).toHaveBeenCalledWith('id', ['product-2', 'product-1']);
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'product-2',
      'product-1',
    ]);
    expect(body.count).toBe(2);
  });

  it('forwards a bounded search offset to the ranked catalog lookup', async () => {
    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [{ product_id: 'product-51', total_count: 51 }],
        error: null,
      }
    );
    storefrontProductsRouteTestHarness.mockProductsByIdsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-51',
          name: 'iPhone 15',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=iphone&limit=50&offset=50'))
    );

    expect(
      storefrontProductsRouteTestHarness.mockSearchRpc.current
    ).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ result_limit: 50, result_offset: 50 })
    );
    expect((await response.json()).products).toHaveLength(1);
  });

  it('chunks ranked search hydration IDs to avoid oversized PostgREST URLs', async () => {
    const rankedIds = Array.from(
      { length: 150 },
      (_, index) => `product-${String(index + 1).padStart(3, '0')}`
    );
    storefrontProductsRouteTestHarness.mockSearchRpc.current
      .mockResolvedValueOnce({
        data: rankedIds.slice(0, 100).map((productId) => ({
          product_id: productId,
          total_count: rankedIds.length,
        })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: rankedIds.slice(100).map((productId) => ({
          product_id: productId,
          total_count: rankedIds.length,
        })),
        error: null,
      });

    storefrontProductsRouteTestHarness.mockProductsByIdsResults.current = [
      {
        data: rankedIds.slice(0, 100).map((id) =>
          storefrontProductsRouteTestHarness.createRawProduct({
            id,
            category: 'Televisions',
            categories: {
              id: 'cat-1',
              name: 'Smart TVs',
              slug: 'smart-tvs',
            },
            name: id,
            slug: id,
          })
        ),
        error: null,
      },
      {
        data: rankedIds.slice(100).map((id) =>
          storefrontProductsRouteTestHarness.createRawProduct({
            id,
            category: 'Televisions',
            categories: {
              id: 'cat-1',
              name: 'Smart TVs',
              slug: 'smart-tvs',
            },
            name: id,
            slug: id,
          })
        ),
        error: null,
      },
    ];

    const response = await GET(
      new NextRequest(createRequestUrl('q=iphone&category=smart-tvs&limit=20'))
    );

    const body = await response.json();
    const idQueries =
      storefrontProductsRouteTestHarness.mockProductsByIdsQueries.current;
    expect(idQueries).toHaveLength(2);
    expect(idQueries[0]?.eq).toHaveBeenCalledWith('status', 'active');
    expect(idQueries[0]?.in).toHaveBeenCalledWith(
      'id',
      rankedIds.slice(0, 100)
    );
    expect(idQueries[1]?.eq).toHaveBeenCalledWith('status', 'active');
    expect(idQueries[1]?.in).toHaveBeenCalledWith('id', rankedIds.slice(100));
    expect(body.products.map((product: { id: string }) => product.id)).toEqual(
      rankedIds.slice(0, 20)
    );
    expect(body.count).toBe(150);
  });

  it('applies the image-presence filter when q and has_images=true are present', async () => {
    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [
          { product_id: 'product-1', total_count: 2 },
          { product_id: 'product-2', total_count: 2 },
        ],
        error: null,
      }
    );

    storefrontProductsRouteTestHarness.mockProductsByIdsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-1',
          name: 'iPhone X',
          images: [],
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-2',
          name: 'iPhone 16 Pro',
          images: ['https://cdn.example.com/iphone-16-pro.jpg'],
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=iphone&has_images=true&limit=20'))
    );

    const body = await response.json();
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'product-2',
    ]);
    expect(body.count).toBe(1);
    expect(
      storefrontProductsRouteTestHarness.mockSearchRpc.current
    ).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ result_limit: 100 })
    );
  });

  it('accepts object image payloads when q and has_images=true are present', async () => {
    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [
          { product_id: 'product-1', total_count: 3 },
          { product_id: 'product-2', total_count: 3 },
          { product_id: 'product-3', total_count: 3 },
        ],
        error: null,
      }
    );

    storefrontProductsRouteTestHarness.mockProductsByIdsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-1',
          name: 'iPhone X',
          images: [],
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-2',
          name: 'iPhone 16 Pro',
          images: ['https://cdn.example.com/iphone-16-pro.jpg'],
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-3',
          name: 'iPhone Case',
          images: [{ url: 'https://cdn.example.com/case.jpg' }],
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=iphone&has_images=true&limit=20'))
    );

    const body = await response.json();
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'product-2',
      'product-3',
    ]);
    expect(body.count).toBe(2);
  });

  it('keeps unexpected unranked hydration rows after ranked products', async () => {
    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [{ product_id: 'product-2', total_count: 1 }],
        error: null,
      }
    );

    storefrontProductsRouteTestHarness.mockProductsByIdsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-1',
          name: 'iPhone Case',
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-2',
          name: 'iPhone 16 Pro',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=iphone&limit=20'))
    );

    const body = await response.json();
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'product-2',
      'product-1',
    ]);
  });
});
