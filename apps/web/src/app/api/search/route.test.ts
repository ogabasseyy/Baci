import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    rpc: mockRpc,
  })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

const MERCHANT_UUID = '11111111-1111-4111-8111-111111111111';

describe('Search API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it('returns 400 when missing query parameter', async () => {
    const req = new NextRequest(
      `http://localhost/api/search?merchant_id=${MERCHANT_UUID}`
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Missing query or merchant_id parameter',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 when missing merchant_id parameter', async () => {
    const req = new NextRequest('http://localhost/api/search?q=test');
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Missing query or merchant_id parameter',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 200 with StorefrontSearchResult payload on success', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ product_id: 'prod-1', total_count: 1 }],
      error: null,
    });

    const req = new NextRequest(
      `http://localhost/api/search?q=test&merchant_id=${MERCHANT_UUID}`
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      count: 1,
      didYouMean: null,
      productIds: ['prod-1'],
      query: 'test',
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        merchant_id_param: MERCHANT_UUID,
        result_limit: 20,
        search_query: 'test',
      })
    );
  });

  it('forwards an explicit limit query parameter', async () => {
    const req = new NextRequest(
      `http://localhost/api/search?q=phone&merchant_id=${MERCHANT_UUID}&limit=5`
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      count: 0,
      didYouMean: null,
      productIds: [],
      query: 'phone',
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        result_limit: 5,
      })
    );
  });

  it('falls back to 20 when limit is non-numeric', async () => {
    const req = new NextRequest(
      `http://localhost/api/search?q=phone&merchant_id=${MERCHANT_UUID}&limit=abc`
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      count: 0,
      didYouMean: null,
      productIds: [],
      query: 'phone',
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        result_limit: 20,
      })
    );
  });

  it('clamps excessive limit query parameters to 100', async () => {
    const req = new NextRequest(
      `http://localhost/api/search?q=phone&merchant_id=${MERCHANT_UUID}&limit=500`
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        result_limit: 100,
      })
    );
  });

  it('returns 400 when merchant_id is not a valid UUID', async () => {
    const req = new NextRequest(
      'http://localhost/api/search?q=test&merchant_id=invalid'
    );
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid merchant_id format' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 500 when the search RPC fails unexpectedly', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Unexpected database error' },
    });

    const req = new NextRequest(
      `http://localhost/api/search?q=test&merchant_id=${MERCHANT_UUID}`
    );
    const res = await GET(req);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to perform search' });
  });
});
