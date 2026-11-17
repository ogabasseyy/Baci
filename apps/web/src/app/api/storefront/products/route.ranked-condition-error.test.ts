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

describe('GET /api/storefront/products ranked condition and error handling', () => {
  beforeEach(() => {
    storefrontProductsRouteTestHarness.reset();
  });

  it('preserves secondary category memberships when q is present', async () => {
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
          name: 'Gaming Monitor',
          category: 'Gaming',
          categories: { id: 'cat-3', name: 'Gaming', slug: 'gaming' },
          product_categories: [
            {
              categories: {
                id: 'cat-1',
                name: 'Smart TVs',
                slug: 'smart-tvs',
              },
            },
          ],
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-2',
          name: 'Console',
          category: 'Gaming',
          categories: { id: 'cat-3', name: 'Gaming', slug: 'gaming' },
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=gaming&category=smart-tvs&limit=20'))
    );

    const body = await response.json();
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'product-1',
    ]);
    expect(body.count).toBe(1);
  });

  it('preserves condition-offer filtering when q is present', async () => {
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
          name: 'iPhone 13',
          condition: 'new',
          has_condition_offers: true,
          available_conditions: [],
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'product-2',
          name: 'iPhone 12',
          condition: 'new',
          has_condition_offers: false,
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=iphone&condition=used&limit=20'))
    );

    const body = await response.json();
    expect(
      storefrontProductsRouteTestHarness.mockSearchRpc.current
    ).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ condition_filter: null, result_limit: 100 })
    );
    expect(body.products.map((product: { id: string }) => product.id)).toEqual([
      'product-1',
    ]);
    expect(body.count).toBe(1);
  });

  it('routes q filters through ranked search without raw ilike OR clauses', async () => {
    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [{ product_id: 'tv-1', total_count: 1 }],
        error: null,
      }
    );
    storefrontProductsRouteTestHarness.mockProductsByIdsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'tv-1',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('q=%_sony\\demo'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(
      storefrontProductsRouteTestHarness.mockSearchRpc.current
    ).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ search_query: '%_sonydemo' })
    );
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current
    ).toBeNull();
  });

  it('returns 500 when the products query fails', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: null as never,
      error: { message: 'db failure' },
    };

    const response = await GET(new NextRequest(createRequestUrl()));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Internal server error');
  });
});
