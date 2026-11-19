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

describe('GET /api/storefront/products projection and condition filters', () => {
  beforeEach(() => {
    storefrontProductsRouteTestHarness.reset();
  });

  it('treats brand=All as no SQL brand prefilter', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'sony-1',
          brand: 'Sony',
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

    const response = await GET(new NextRequest(createRequestUrl('brand=All')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(2);
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.ilike
    ).not.toHaveBeenCalledWith('brand', expect.any(String));
  });

  it('keeps database-side limit when no in-memory filters are active', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'sony-1',
          brand: 'Sony',
        }),
      ],
      error: null,
    };

    const response = await GET(new NextRequest(createRequestUrl('limit=5')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.limit
    ).toHaveBeenCalledWith(5);
  });

  it('uses the compact product projection when requested by listing callers', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'compact-1',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('compact=true&limit=5'))
    );
    const payload = await response.json();
    const selectArg = String(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.select.mock
        .calls[0]?.[0]
    );

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(selectArg).not.toContain('description');
    expect(selectArg).toContain('has_variants');
    expect(selectArg).toContain('categories:category_id(id, name, slug)');
    expect(selectArg).not.toContain('specifications');
    expect(selectArg).not.toContain('product_key_specs');
    expect(selectArg).not.toContain('variant_attributes');
    expect(selectArg).not.toMatch(/\boffers\b/);
  });

  it('defaults listing callers to the compact product projection', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'default-compact-1',
        }),
      ],
      error: null,
    };

    const response = await GET(new NextRequest(createRequestUrl('limit=5')));
    const payload = await response.json();
    const selectArg = String(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.select.mock
        .calls[0]?.[0]
    );

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(selectArg).toContain('has_variants');
    expect(selectArg).not.toContain('specifications');
    expect(selectArg).not.toContain('variant_attributes');
  });

  it('allows explicit full projection for comparison-style callers', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'full-1',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('compact=false&limit=5'))
    );
    const payload = await response.json();
    const selectArg = String(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.select.mock
        .calls[0]?.[0]
    );

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(selectArg).toContain('specifications');
    expect(selectArg).toContain('variant_attributes');
    expect(selectArg).toContain('product_key_specs (');
    expect(selectArg).toContain('created_at');
    expect(selectArg).toContain('updated_at');
    expect(selectArg).toMatch(/\boffers\b/);
  });

  it('applies the image-presence filter when has_images=true', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'with-image-1',
          images: ['https://cdn.example.com/with-image.jpg'],
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('has_images=true'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.not
    ).toHaveBeenCalledWith('images->0', 'is', null);
  });

  it('matches condition filters against available_conditions for migrated families', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'family-1',
          name: 'MacBook Air Family',
          available_conditions: ['new', 'open_box'],
          condition: 'new',
        }),
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'family-2',
          name: 'MacBook Air New',
          available_conditions: ['new'],
          condition: 'new',
          slug: 'macbook-air-new',
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('condition=open_box'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(payload.products[0].id).toBe('family-1');
  });

  it('broadens open_box condition prefilters to include refurbished aliases', async () => {
    storefrontProductsRouteTestHarness.mockProductsResult.current = {
      data: [
        storefrontProductsRouteTestHarness.createRawProduct({
          id: 'family-1',
          name: 'MacBook Air Refurbished',
          condition: 'refurbished',
          available_conditions: [],
        }),
      ],
      error: null,
    };

    const response = await GET(
      new NextRequest(createRequestUrl('condition=open_box'))
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products).toHaveLength(1);
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.or
    ).toHaveBeenCalledTimes(1);
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.or.mock
        .calls[0]?.[0]
    ).toContain('condition.eq.open_box');
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.or.mock
        .calls[0]?.[0]
    ).toContain('condition.eq.refurbished');
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.or.mock
        .calls[0]?.[0]
    ).toContain('available_conditions.cs.{open_box}');
    expect(
      storefrontProductsRouteTestHarness.mockProductsQuery.current?.or.mock
        .calls[0]?.[0]
    ).toContain('available_conditions.cs.{refurbished}');
  });
});
