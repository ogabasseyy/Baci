import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { GET } from './route';

describe('GET /api/products/count', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns 400 when merchant_id is missing', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/products/count')
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing merchant_id parameter',
    });
  });

  it('returns client recommendedMethod when count <= 500', async () => {
    mockRpc.mockResolvedValueOnce({ data: 42, error: null });

    const response = await GET(
      new NextRequest('http://localhost/api/products/count?merchant_id=m-1')
    );

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('get_merchant_product_count', {
      merchant_id_param: 'm-1',
    });
    await expect(response.json()).resolves.toEqual({
      count: 42,
      recommendedMethod: 'client',
      threshold: 500,
    });
  });

  it('returns server recommendedMethod when count > 500', async () => {
    mockRpc.mockResolvedValueOnce({ data: 501, error: null });

    const response = await GET(
      new NextRequest('http://localhost/api/products/count?merchant_id=m-1')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      count: 501,
      recommendedMethod: 'server',
      threshold: 500,
    });
  });

  it('returns 500 when RPC fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    try {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: new Error('db failure'),
      });

      const response = await GET(
        new NextRequest('http://localhost/api/products/count?merchant_id=m-1')
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: 'Failed to get product count',
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
