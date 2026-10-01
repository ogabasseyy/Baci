import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  forIntegration: vi.fn(),
  getAllOrders: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  requireMerchantFeatureAccess: vi.fn(),
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn((table: string) => {
      if (table === 'marketplace_integrations') {
        const scopeResult = Promise.resolve({
          data: [{ marketplace_key: 'Jumia Nigeria' }],
          error: null,
        });
        const scopeQuery: {
          eq: ReturnType<typeof vi.fn>;
          or: ReturnType<typeof vi.fn>;
          then: (resolve: (value: unknown) => unknown) => unknown;
        } = {
          eq: vi.fn(() => scopeQuery),
          or: vi.fn(() => scopeResult),
          // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are intentionally thenable.
          then: (resolve: (value: unknown) => unknown) =>
            scopeResult.then(resolve),
        };
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          })),
          select: vi.fn(() => scopeQuery),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: (...args: unknown[]) => mocks.hasPermission(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyJumiaOrder: vi.fn(),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.getMerchantForApiRequest(...args),
  toUserAccess: vi.fn(() => ({})),
}));

vi.mock('@/lib/jumia/client', () => ({
  JumiaApiError: class JumiaApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  JumiaClient: {
    forIntegration: (...args: unknown[]) => mocks.forIntegration(...args),
  },
  jumiaErrorResponse: (error: { message: string; status: number }) =>
    Response.json({ error: error.message }, { status: error.status }),
}));

vi.mock('@/lib/jumia/orders', () => ({
  getAllOrders: (...args: unknown[]) => mocks.getAllOrders(...args),
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

import { POST } from './route';

const INTEGRATION_ID = '00000000-0000-4000-8000-000000000099';

function makePostRequest() {
  return new NextRequest(
    `http://localhost/api/marketplace/jumia/orders?integrationId=${INTEGRATION_ID}`,
    { method: 'POST' }
  );
}

describe('Jumia orders POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: '00000000-0000-4000-8000-000000000001',
    });
    mocks.hasPermission.mockReturnValue(true);
    mocks.requireMerchantFeatureAccess.mockResolvedValue(null);
    mocks.forIntegration.mockResolvedValue({
      shopId: 'shop-1',
      countryCode: 'NG',
      marketplaceKey: 'Jumia Nigeria',
    });
    mocks.getAllOrders.mockResolvedValue([]);
  });

  it('returns 402 before syncing orders when marketplace sync is locked', async () => {
    mocks.requireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Marketplace sync requires Baci Pro',
        },
        { status: 402 }
      )
    );

    const response = await POST(makePostRequest());

    expect(response.status).toBe(402);
    const json = await response.json();
    expect(json.code).toBe('requires_upgrade');
    expect(mocks.forIntegration).not.toHaveBeenCalled();
    expect(mocks.getAllOrders).not.toHaveBeenCalled();
  });

  it('returns 500 before syncing orders when marketplace entitlement lookup fails', async () => {
    mocks.requireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        { error: 'Failed to verify merchant plan' },
        { status: 500 }
      )
    );

    const response = await POST(makePostRequest());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe('Failed to verify merchant plan');
    expect(mocks.forIntegration).not.toHaveBeenCalled();
    expect(mocks.getAllOrders).not.toHaveBeenCalled();
  });

  it('syncs orders when marketplace sync is available', async () => {
    const response = await POST(makePostRequest());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({ success: true, synced: 0, newOrders: 0 });
    expect(mocks.forIntegration).toHaveBeenCalledWith(
      mocks.supabase,
      '00000000-0000-4000-8000-000000000001',
      INTEGRATION_ID
    );
    expect(mocks.getAllOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: 'shop-1',
        countryCode: 'NG',
        marketplaceKey: 'Jumia Nigeria',
      }),
      expect.objectContaining({
        country: 'NG',
        shopId: 'shop-1',
        createdAfter: expect.any(String),
      })
    );
  });

  it('syncs orders on the default OAuth integration without country or shop filters', async () => {
    mocks.forIntegration.mockResolvedValueOnce({
      shopId: 'oauth',
      countryCode: 'NG',
      marketplaceKey: 'oauth',
    });

    const response = await POST(makePostRequest());

    expect(response.status).toBe(200);
    expect(mocks.getAllOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: 'oauth',
        countryCode: 'NG',
        marketplaceKey: 'oauth',
      }),
      expect.objectContaining({
        createdAfter: expect.any(String),
      })
    );
    expect(mocks.getAllOrders.mock.calls[0]?.[1]).not.toHaveProperty('country');
    expect(mocks.getAllOrders.mock.calls[0]?.[1]).not.toHaveProperty('shopId');
  });

  it('syncs OAuth shop orders by shop id only so collapsed country does not drop peers', async () => {
    mocks.forIntegration.mockResolvedValueOnce({
      shopId: 'shop-multi',
      countryCode: 'NG',
      marketplaceKey: 'oauth',
    });

    const response = await POST(makePostRequest());

    expect(response.status).toBe(200);
    expect(mocks.getAllOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: 'shop-multi',
        countryCode: 'NG',
        marketplaceKey: 'oauth',
      }),
      expect.objectContaining({
        shopId: 'shop-multi',
        createdAfter: expect.any(String),
      })
    );
    expect(mocks.getAllOrders.mock.calls[0]?.[1]).not.toHaveProperty('country');
  });
});
