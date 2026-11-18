import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontProductsRouteTestHarness } from './route.test-helpers';

vi.mock('@supabase/supabase-js', () => ({
  createClient: storefrontProductsRouteTestHarness.mockCreateStaticClient,
}));

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  unstable_cache:
    <T extends (...args: never[]) => Promise<unknown>>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));

vi.mock('@/env', () => ({
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseUrl: vi.fn(() => 'https://example.supabase.co'),
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: storefrontProductsRouteTestHarness.mockCreateServerClient,
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

describe('GET /api/storefront/products ranked search filters', () => {
  beforeEach(() => {
    storefrontProductsRouteTestHarness.reset();
  });

  it('preserves category filtering when q is present', async () => {
    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [
          { product_id: 'product-3', total_count: 3 },
          { product_id: 'product-2', total_count: 3 },
          { product_id: 'product-1', total_count: 3 },
        ],
        error: null,
      }
    );

    storefrontProductsRouteTestHarness.mockProductsByIdsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-1',
          name: 'iPhone Case',
          category: 'Accessories',
          categories: {
            id: 'cat-1',
            name: 'Accessories',
            slug: 'accessories',
          },
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-2',
          name: 'iPhone 16 Pro',
          category: 'Phones',
          categories: { id: 'cat-2', name: 'Phones', slug: 'phones' },
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-3',
          name: 'iPhone Stand',
          category: 'Accessories',
          categories: {
            id: 'cat-1',
            name: 'Accessories',
            slug: 'accessories',
          },
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=iphone&category=phones&limit=20'))
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

  it('continues ranked paging until post-filtered storefront matches beyond 500 candidates are found', async () => {
    const rankedIds = Array.from(
      { length: 600 },
      (_, index) => `product-${String(index + 1).padStart(3, '0')}`
    );

    for (let offset = 0; offset < rankedIds.length; offset += 100) {
      storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
        {
          data: rankedIds.slice(offset, offset + 100).map((productId) => ({
            product_id: productId,
            total_count: rankedIds.length,
          })),
          error: null,
        }
      );
    }

    storefrontProductsRouteTestHarness.mockProductsByIdsResults.current =
      rankedIds.reduce<Array<{ data: Record<string, unknown>[]; error: null }>>(
        (pages, _id, index) => {
          if (index % 100 !== 0) {
            return pages;
          }

          const chunk = rankedIds.slice(index, index + 100);
          pages.push({
            data: chunk.map((id) =>
              storefrontProductsRouteTestHarness.createRawProduct({
                id,
                category: id === 'product-550' ? 'Phones' : 'Accessories',
                categories:
                  id === 'product-550'
                    ? { id: 'cat-2', name: 'Phones', slug: 'phones' }
                    : { id: 'cat-1', name: 'Accessories', slug: 'accessories' },
                name: id,
                slug: id,
              })
            ),
            error: null,
          });
          return pages;
        },
        []
      );

    const response = await GET(
      new NextRequest(createRequestUrl('q=iphone&category=phones&limit=20'))
    );

    const body = await response.json();
    expect(
      storefrontProductsRouteTestHarness.mockSearchRpc.current
    ).toHaveBeenCalledTimes(6);
    expect(
      storefrontProductsRouteTestHarness.mockSearchRpc.current
    ).toHaveBeenNthCalledWith(
      6,
      'search_products_v2',
      expect.objectContaining({ result_offset: 500, result_limit: 100 })
    );
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'product-550',
    ]);
    expect(body.count).toBe(1);
  });

  it('preserves slug-form brand filtering when q is present', async () => {
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
          name: 'Sony Ericsson Xperia',
          brand: 'Sony Ericsson',
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-2',
          name: 'LG C3',
          brand: 'LG',
          slug: 'lg-c3',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=phone&brand=sony-ericsson&limit=1'))
    );

    const body = await response.json();
    expect(
      storefrontProductsRouteTestHarness.mockSearchRpc.current
    ).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ brand_filter: null, result_limit: 100 })
    );
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'product-1',
    ]);
    expect(body.count).toBe(1);
  });

  it('keeps ranked count when q is present with all filters', async () => {
    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [{ product_id: 'product-1', total_count: 7 }],
        error: null,
      }
    );

    storefrontProductsRouteTestHarness.mockProductsByIdsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-1',
          name: 'iPhone 16 Pro',
          brand: 'Apple',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(
        createRequestUrl(
          'q=iphone&brand=All&category=All&condition=all&limit=1'
        )
      )
    );

    const body = await response.json();
    expect(
      storefrontProductsRouteTestHarness.mockSearchRpc.current
    ).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ result_limit: 1 })
    );
    expect(body.count).toBe(7);
  });
});
