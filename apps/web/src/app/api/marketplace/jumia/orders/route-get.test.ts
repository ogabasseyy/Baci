import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  requireMerchantFeatureAccess: vi.fn(),
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: (...args: unknown[]) => mocks.hasPermission(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.getMerchantForApiRequest(...args),
  toUserAccess: vi.fn(() => ({})),
}));

vi.mock('@/lib/jumia/client', () => ({
  JumiaApiError: class JumiaApiError extends Error {
    status = 500;
  },
  JumiaClient: { forIntegration: vi.fn() },
  jumiaErrorResponse: vi.fn(),
}));

vi.mock('@/lib/jumia/orders', () => ({
  getAllOrders: vi.fn(),
  getOrderItems: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mocks.requireMerchantFeatureAccess(...args),
}));

vi.mock('@/lib/sanitize-core', () => ({
  sanitizeText: (value: string) => value,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mocks.supabase),
}));

import { GET } from './route';

const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const INTEGRATION_ID = '00000000-0000-4000-8000-000000000099';

describe('Jumia orders GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: MERCHANT_ID,
    });
    mocks.hasPermission.mockReturnValue(true);
    mocks.requireMerchantFeatureAccess.mockResolvedValue(null);
  });

  it('uses the integration shop and marketplace scope for cached orders', async () => {
    const integrationQuery = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          marketplace_key: 'NG-main',
          shop_id: 'jumia-shop-123',
        },
        error: null,
      }),
    };
    integrationQuery.eq.mockReturnValue(integrationQuery);

    const orderQuery = {
      eq: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    orderQuery.eq.mockReturnValue(orderQuery);
    orderQuery.in.mockReturnValue(orderQuery);
    orderQuery.order.mockReturnValue(orderQuery);
    orderQuery.range.mockReturnValue(orderQuery);

    const integrationSelect = vi.fn(() => integrationQuery);
    const orderSelect = vi.fn(() => orderQuery);
    mocks.supabase.from.mockImplementation((table: string) => {
      if (table === 'marketplace_integrations') {
        return { select: integrationSelect };
      }
      if (table === 'jumia_orders') {
        return { select: orderSelect };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await GET(
      new NextRequest(
        `http://localhost/api/marketplace/jumia/orders?integrationId=${INTEGRATION_ID}`
      )
    );

    expect(response.status).toBe(200);
    expect(integrationSelect).toHaveBeenCalledWith('shop_id, marketplace_key');
    expect(integrationQuery.eq).toHaveBeenCalledWith('id', INTEGRATION_ID);
    expect(orderQuery.eq).toHaveBeenCalledWith(
      'jumia_shop_id',
      'jumia-shop-123'
    );
    expect(orderQuery.in).toHaveBeenCalledWith('marketplace_key', [
      'NG-main',
      'default',
    ]);
  });
});
