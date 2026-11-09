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
    expect(body.pagination).toEqual({
      hasMore: false,
      totalCount: 2,
      limit: 20,
      offset: 0,
    });
  });

  it('forwards a bounded search offset to the ranked catalog lookup and reports pagination with hasMore', async () => {
    storefrontProductsRouteTestHarness.mockSearchRpc.current.mockResolvedValueOnce(
      {
        data: [{ product_id: 'product-51', total_count: 120 }],
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
    const body = await response.json();
    expect(body.products).toHaveLength(1);
    expect(body.count).toBe(120);
    expect(body.pagination).toEqual({
      hasMore: true,
      totalCount: 120,
      limit: 50,
      offset: 50,
    });
  });
});
