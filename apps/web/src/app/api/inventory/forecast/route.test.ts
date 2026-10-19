import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  toUserAccess: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/api-auth', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.getMerchantForApiRequest,
  toUserAccess: mocks.toUserAccess,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

import { GET } from './route';

describe('inventory forecast dashboard API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
    });
    mocks.hasPermission.mockReturnValue(true);
    mocks.toUserAccess.mockReturnValue({ permissions: {} });
  });

  it('loads a 10,000-product summary with one bounded bulk RPC', async () => {
    const from = vi.fn();
    const rpc = vi.fn().mockResolvedValue({
      data: {
        forecasts: [{ daysOfStock: 2, productId: 'urgent' }],
        summary: {
          critical: 1_500,
          healthy: 5_750,
          outOfStock: 750,
          totalProducts: 10_000,
          warning: 2_000,
        },
      },
      error: null,
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from,
      rpc,
    });
    const requestedMerchantId = '123e4567-e89b-42d3-a456-426614174000';

    const response = await GET(
      new Request('https://usebaci.com/api/inventory/forecast?limit=100', {
        headers: { 'x-baci-merchant-id': requestedMerchantId },
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId }
    );
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('get_inventory_forecast_dashboard', {
      p_limit: 100,
      p_low_stock_only: false,
      p_merchant_id: 'merchant-1',
      p_offset: 0,
    });
    expect(from).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      forecasts: [{ productId: 'urgent' }],
      pagination: { total: 10_000, totalPages: 100 },
      summary: { critical: 1_500, outOfStock: 750, warning: 2_000 },
    });
  });

  it('rejects an excessive page size before reading products', async () => {
    const from = vi.fn();
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from,
    });

    const response = await GET(
      new Request(
        'https://usebaci.com/api/inventory/forecast?limit=101'
      ) as unknown as NextRequest
    );

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a product outside the selected merchant before forecasting it', async () => {
    const productQuery = {
      eq: vi.fn(() => productQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn(() => productQuery),
    };
    const rpc = vi.fn();
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from: vi.fn(() => productQuery),
      rpc,
    });

    const response = await GET(
      new Request(
        'https://usebaci.com/api/inventory/forecast?productId=123e4567-e89b-42d3-a456-426614174111'
      ) as unknown as NextRequest
    );

    expect(response.status).toBe(404);
    expect(productQuery.eq).toHaveBeenNthCalledWith(
      1,
      'merchant_id',
      'merchant-1'
    );
    expect(productQuery.eq).toHaveBeenNthCalledWith(
      2,
      'id',
      '123e4567-e89b-42d3-a456-426614174111'
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
