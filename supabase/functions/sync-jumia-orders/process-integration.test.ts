import { describe, expect, it, vi } from 'vitest';

const getValidToken = vi.hoisted(() => vi.fn());
const refreshToken = vi.hoisted(() => vi.fn());
const fetchOrders = vi.hoisted(() => vi.fn());
const syncStock = vi.hoisted(() => vi.fn());

vi.mock('./token', () => ({
  getValidJumiaToken: getValidToken,
  refreshJumiaToken: refreshToken,
}));
vi.mock('./orders', () => ({ fetchAllJumiaOrders: fetchOrders }));
vi.mock('./stock', () => ({ syncJumiaStockForIntegration: syncStock }));

import { processJumiaIntegration } from './process-integration';

function createSupabase() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => Promise.resolve({ data: [], error: null })),
    update: vi.fn(() => query),
    upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
  return { from: vi.fn(() => query) };
}

const integration = {
  id: 'integration-1',
  merchant_id: 'merchant-1',
  shop_id: 'shop-1',
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  last_sync_at: null,
  sync_config: null,
};

describe('processJumiaIntegration', () => {
  it('syncs fetched orders and reports the count', async () => {
    getValidToken.mockResolvedValue('access-token');
    fetchOrders.mockResolvedValue([
      {
        id: 'order-1',
        number: 1001,
        status: 'created',
        createdAt: '2026-09-02T00:00:00Z',
        shippingAddress: null,
        totalAmount: { currency: 'NGN', value: 1000 },
      },
    ]);
    const result = await processJumiaIntegration({
      supabase: createSupabase() as never,
      integration,
      tokenConfig: {
        apiBase: 'https://vendor-api.example',
        clientId: 'client-id',
        refreshBufferMs: 300000,
      },
      ordersConfig: { apiBase: 'https://vendor-api.example', maxPages: 100 },
      stockConfig: { apiBase: 'https://vendor-api.example' },
    });

    expect(result).toEqual({ synced: 1, newOrders: 1, errors: [] });
    expect(fetchOrders).toHaveBeenCalledWith(
      expect.anything(),
      integration,
      'access-token',
      expect.any(String),
      expect.any(String),
      expect.anything(),
      expect.any(Function)
    );
  });

  it('records a provider failure without throwing from the worker loop', async () => {
    getValidToken.mockRejectedValue(new Error('token unavailable'));
    const result = await processJumiaIntegration({
      supabase: createSupabase() as never,
      integration,
      tokenConfig: {
        apiBase: 'https://vendor-api.example',
        clientId: 'client-id',
        refreshBufferMs: 300000,
      },
      ordersConfig: { apiBase: 'https://vendor-api.example', maxPages: 100 },
      stockConfig: { apiBase: 'https://vendor-api.example' },
    });

    expect(result).toEqual({
      synced: 0,
      newOrders: 0,
      errors: ['merchant-1: token unavailable'],
    });
  });
});
