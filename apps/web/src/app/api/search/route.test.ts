import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  InvalidMerchantIdError,
  searchStorefrontProducts,
} from '@/lib/storefront-search';
import { GET } from './route';

vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: vi.fn(),
  InvalidMerchantIdError: class InvalidMerchantIdError extends Error {
    constructor() {
      super('Invalid merchant ID format');
      this.name = 'InvalidMerchantIdError';
    }
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({})),
}));

describe('Search API', () => {
  it('returns 400 when missing query parameter', async () => {
    const req = new NextRequest('http://localhost/api/search?merchant_id=123');
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Missing query or merchant_id parameter',
    });
  });

  it('returns 400 when missing merchant_id parameter', async () => {
    const req = new NextRequest('http://localhost/api/search?q=test');
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Missing query or merchant_id parameter',
    });
  });

  it('returns 200 with search results on success', async () => {
    const mockResult = { products: [], metadata: { count: 0 } };
    vi.mocked(searchStorefrontProducts).mockResolvedValueOnce(mockResult);

    const req = new NextRequest(
      'http://localhost/api/search?q=test&merchant_id=uuid'
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockResult);
    expect(searchStorefrontProducts).toHaveBeenCalledWith({
      supabase: expect.any(Object),
      merchantId: 'uuid',
      query: 'test',
      limit: 20,
    });
  });

  it('returns 400 when InvalidMerchantIdError is thrown', async () => {
    vi.mocked(searchStorefrontProducts).mockRejectedValueOnce(
      new InvalidMerchantIdError()
    );

    const req = new NextRequest(
      'http://localhost/api/search?q=test&merchant_id=invalid'
    );
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid merchant_id format' });
  });

  it('returns 500 when an unexpected error is thrown', async () => {
    vi.mocked(searchStorefrontProducts).mockRejectedValueOnce(
      new Error('Unexpected database error')
    );

    const req = new NextRequest(
      'http://localhost/api/search?q=test&merchant_id=uuid'
    );
    const res = await GET(req);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to perform search' });
  });
});
