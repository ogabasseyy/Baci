import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckCsrfProtection = vi.fn();
const mockCreateClient = vi.fn();
const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockRevalidateAnalytics = vi.fn();

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateAnalytics: () => mockRevalidateAnalytics(),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));
vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

function createAnalyticsPayload() {
  return {
    businessTypeCounts: [{ businessType: 'fashion', merchants: 75 }],
    dailyGmv: [],
    generatedAt: '2026-08-05T14:00:00+00:00',
    growth: {
      gmvGrowthRate: 0,
      merchantGrowthRate: 0,
      newMerchantsThisMonth: 0,
    },
    merchantActivation: [],
    merchantHealth: { atRisk: 0, churned: 1, healthy: 1, new: 73 },
    paymentMethods: [],
    paymentStatuses: [],
    salesByChannel: [],
    shippingStatuses: [],
    signupSources: [],
    summary: {
      activeMerchantChange: 0,
      activeMerchants: 56,
      aovChange: 0,
      avgGmvPerMerchant: 1_006_250_410.72,
      avgOrderValue: 724_442.34,
      gmvChange: 0,
      grossGmv: 4_138_510_676.5,
      grossOrders: 4861,
      excludedNonNgnOrUnknownGrossOrders: 3,
      excludedNonNgnOrUnknownPaidOrders: 2,
      recordedMerchantNet: null,
      orderChange: 0,
      recordedPlatformFees: null,
      recordedProcessorFees: null,
      reportingCurrency: 'NGN',
      sellingMerchants: 2,
      totalGmv: 2_012_500_821.44,
      totalMerchants: 75,
      totalOrders: 2778,
    },
    topMerchants: [],
  };
}

function createMockSupabase({
  rpcError = null,
}: {
  rpcError?: { code?: string; message: string } | null;
} = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({
      data: rpcError ? null : createAnalyticsPayload(),
      error: rpcError,
    }),
  };
}

function createRequest(url: string, init: RequestInit = {}): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

const analyticsUrl = 'http://localhost/api/admin/analytics';
let mockSupabase = createMockSupabase();

import { GET, POST } from './route';

describe('/api/admin/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabase();
    mockCreateClient.mockReturnValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      context: { permissions: ['analytics.read'], role: 'viewer' },
      status: 'authenticated',
      user: { email: 'viewer@example.com', id: 'membership-only-viewer' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  });

  it('returns 401 before analytics work when the user is unauthenticated', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    const response = await GET(createRequest(analyticsUrl));

    expect(response.status).toBe(401);
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'analytics.read'
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid periods after the permission boundary', async () => {
    const response = await GET(createRequest(`${analyticsUrl}?period=14d`));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_PERIOD' });
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'analytics.read'
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('rejects a caller without analytics.read', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'forbidden',
    });
    const response = await GET(createRequest(analyticsUrl));

    expect(response.status).toBe(403);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('allows a membership-only viewer with analytics.read to use the aggregate RPC', async () => {
    const response = await GET(createRequest(`${analyticsUrl}?period=all`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({
      activeMerchants: 56,
      grossOrders: 4861,
      sellingMerchants: 2,
      totalMerchants: 75,
      totalOrders: 2778,
    });
    expect(mockSupabase.rpc).toHaveBeenCalledOnce();
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'get_admin_platform_analytics',
      { p_period: 'all' }
    );
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'analytics.read'
    );
  });

  it('returns 500 instead of partial data when the aggregate fails', async () => {
    mockSupabase = createMockSupabase({
      rpcError: { code: 'XX000', message: 'aggregate unavailable' },
    });
    mockCreateClient.mockReturnValue(mockSupabase);

    const response = await GET(createRequest(`${analyticsUrl}?period=30d`));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to fetch analytics data',
    });
  });

  it('authenticates and authorizes refresh without a service-role client', async () => {
    const response = await POST(
      createRequest(analyticsUrl, { method: 'POST' })
    );

    expect(response.status).toBe(200);
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'analytics.read'
    );
    expect(mockCheckCsrfProtection).toHaveBeenCalledOnce();
    expect(mockRevalidateAnalytics).toHaveBeenCalledOnce();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('rejects refresh when CSRF validation fails', async () => {
    mockCheckCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: new Response(JSON.stringify({ error: 'CSRF invalid' }), {
        status: 403,
      }),
    });

    const response = await POST(
      createRequest(analyticsUrl, { method: 'POST' })
    );

    expect(response.status).toBe(403);
    expect(mockRevalidateAnalytics).not.toHaveBeenCalled();
  });
});
