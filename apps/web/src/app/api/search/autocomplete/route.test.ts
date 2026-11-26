import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetStorefrontAutocompleteProducts = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/storefront-search-autocomplete', () => ({
  AUTOCOMPLETE_SATURATED_CODE: 'autocomplete_saturated',
  getStorefrontAutocompleteProducts: (...args: unknown[]) =>
    mockGetStorefrontAutocompleteProducts(...args),
}));

import { GET } from './route';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/search/autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches layered CDN cache headers and merchant product tag on 200 responses', async () => {
    mockGetStorefrontAutocompleteProducts.mockResolvedValueOnce({
      suggestions: [{ id: 'p1', name: 'iPhone 16', slug: 'iphone-16' }],
      popularSearches: [],
    });

    const response = await GET(
      new NextRequest(
        `https://ogabassey.com/api/search/autocomplete?q=iphone&merchant_id=${MERCHANT_ID}`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=30, stale-while-revalidate=300'
    );
    expect(response.headers.get('CDN-Cache-Control')).toBe(
      'public, max-age=120, stale-while-revalidate=600, stale-if-error=600'
    );
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'public, max-age=120, stale-while-revalidate=600'
    );
    expect(response.headers.get('Vercel-Cache-Tag')).toBe(
      `products-${MERCHANT_ID}`
    );
  });

  it('leaves saturated fallback responses uncached at the edge', async () => {
    mockGetStorefrontAutocompleteProducts.mockRejectedValueOnce({
      code: 'autocomplete_saturated',
    });

    const response = await GET(
      new NextRequest(
        `https://ogabassey.com/api/search/autocomplete?q=iphone&merchant_id=${MERCHANT_ID}`
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
    expect(response.headers.get('CDN-Cache-Control')).toBeNull();
  });

  it('returns 400 without edge cache headers when merchant_id is invalid', async () => {
    const response = await GET(
      new NextRequest(
        'https://ogabassey.com/api/search/autocomplete?q=iphone&merchant_id=bad-id'
      )
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
  });
});
