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

describe('GET /api/storefront/products category and brand filters', () => {
  beforeEach(() => {
    storefrontProductsRouteTestHarness.reset();
  });

  it('matches category filters against category slugs as well as names', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'tv-1',
          category: 'Televisions',
          categories: { id: 'cat-1', name: 'Smart TVs', slug: 'smart-tvs' },
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'phone-1',
          name: 'Galaxy S24',
          category: 'Phones',
          categories: { id: 'cat-2', name: 'Phones', slug: 'phones' },
          brand: 'Samsung',
          slug: 'galaxy-s24',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('category=smart-tvs'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(payload.products[0].id).toBe('tv-1');
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.ilike
    ).not.toHaveBeenCalledWith('category', expect.any(String));
  });

  it('preserves secondary category memberships during in-memory category filtering', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'tv-2',
          category: 'Gaming',
          categories: { id: 'cat-3', name: 'Consoles', slug: 'consoles' },
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
          id: 'console-1',
          category: 'Consoles',
          categories: { id: 'cat-3', name: 'Consoles', slug: 'consoles' },
          slug: 'console-1',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('category=smart-tvs'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(payload.products[0].id).toBe('tv-2');
  });

  it('applies limit after in-memory category filtering', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'phone-1',
          category: 'Phones',
          categories: { id: 'cat-2', name: 'Phones', slug: 'phones' },
          slug: 'phone-1',
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'tv-2',
          category: 'Televisions',
          categories: { id: 'cat-1', name: 'Smart TVs', slug: 'smart-tvs' },
          slug: 'tv-2',
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'tv-3',
          category: 'Televisions',
          categories: { id: 'cat-1', name: 'Smart TVs', slug: 'smart-tvs' },
          slug: 'tv-3',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('category=smart-tvs&limit=1'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(payload.products[0].id).toBe('tv-2');
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.limit
    ).not.toHaveBeenCalled();
  });

  it('matches slug-form brand filters without relying on a SQL ilike prefilter', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'sony-ericsson-1',
          brand: 'Sony Ericsson',
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'lg-1',
          name: 'LG C3',
          brand: 'LG',
          slug: 'lg-c3',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('brand=sony-ericsson'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(payload.products[0].brand).toBe('Sony Ericsson');
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.ilike
    ).not.toHaveBeenCalledWith('brand', expect.any(String));
  });
});
