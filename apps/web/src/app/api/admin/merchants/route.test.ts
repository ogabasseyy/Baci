import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockCreateClient = vi.fn();
const merchantOneId = '123e4567-e89b-42d3-a456-426614174001';
const merchantTwoId = '123e4567-e89b-42d3-a456-426614174002';

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

type QueryResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

let rpcResult: QueryResult<
  Array<{
    merchant_id: string;
    business_name: string | null;
    email: string | null;
    joined_at: string;
    total_gmv: number;
    total_orders: number;
    excluded_non_ngn_or_unknown_paid_orders: number;
    last_order_date: string | null;
    active_days: number;
    health_status: 'healthy' | 'at_risk' | 'churned' | 'new';
    storefront_slug: string | null;
  }>
> = {
  data: [
    {
      merchant_id: merchantOneId,
      business_name: 'Baci Store',
      email: 'owner@example.com',
      joined_at: '2026-03-20T10:00:00.000Z',
      total_gmv: 400,
      total_orders: 2,
      last_order_date: '2026-03-19',
      active_days: 2,
      excluded_non_ngn_or_unknown_paid_orders: 0,
      health_status: 'healthy',
      storefront_slug: 'baci-store',
    },
    {
      merchant_id: merchantTwoId,
      business_name: 'Another Store',
      email: 'another@example.com',
      joined_at: '2026-03-21T10:00:00.000Z',
      total_gmv: 100,
      total_orders: 5,
      last_order_date: '2026-03-18',
      active_days: 1,
      excluded_non_ngn_or_unknown_paid_orders: 1,
      health_status: 'at_risk',
      storefront_slug: 'another-store',
    },
  ],
  error: null,
};

function createMockSupabase() {
  return {
    rpc: vi.fn((name: string) => {
      if (name !== 'get_admin_merchant_health_v2') {
        throw new Error(`Unexpected RPC: ${name}`);
      }

      return rpcResult;
    }),
  };
}

function createRequest(url: string): NextRequest {
  return new Request(url) as NextRequest;
}

import { GET } from './route';

describe('/api/admin/merchants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcResult = {
      data: [
        {
          merchant_id: merchantOneId,
          business_name: 'Baci Store',
          email: 'owner@example.com',
          joined_at: '2026-03-20T10:00:00.000Z',
          total_gmv: 400,
          total_orders: 2,
          last_order_date: '2026-03-19',
          active_days: 2,
          excluded_non_ngn_or_unknown_paid_orders: 0,
          health_status: 'healthy',
          storefront_slug: 'baci-store',
        },
        {
          merchant_id: merchantTwoId,
          business_name: 'Another Store',
          email: 'another@example.com',
          joined_at: '2026-03-21T10:00:00.000Z',
          total_gmv: 100,
          total_orders: 5,
          last_order_date: '2026-03-18',
          active_days: 1,
          excluded_non_ngn_or_unknown_paid_orders: 1,
          health_status: 'at_risk',
          storefront_slug: 'another-store',
        },
      ],
      error: null,
    };
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      context: { permissions: ['merchants.read'], role: 'support' },
      status: 'authenticated',
      user: { email: 'support@example.com', id: 'membership-only-support' },
    });
    mockCreateClient.mockResolvedValue(createMockSupabase());
  });

  it('returns 401 when the user is not authenticated', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    const response = await GET(
      createRequest('http://localhost/api/admin/merchants')
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'merchants.read'
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid sort parameter', async () => {
    const response = await GET(
      createRequest('http://localhost/api/admin/merchants?sortBy=health')
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_MERCHANTS_QUERY');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller lacks merchants.read', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'forbidden',
    });

    const response = await GET(
      createRequest('http://localhost/api/admin/merchants')
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns 500 when the admin merchant health RPC fails', async () => {
    rpcResult = {
      data: null,
      error: { message: 'rpc failed' },
    };
    mockCreateClient.mockResolvedValue(createMockSupabase());

    const response = await GET(
      createRequest('http://localhost/api/admin/merchants')
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to fetch merchant data');
  });

  it('returns 403 when the database permission boundary rejects the read', async () => {
    rpcResult = {
      data: null,
      error: { code: '42501', message: 'permission denied' },
    };
    mockCreateClient.mockResolvedValue(createMockSupabase());

    const response = await GET(
      createRequest('http://localhost/api/admin/merchants')
    );

    expect(response.status).toBe(403);
  });

  it('passes the requested sort to the server-sorted bounded RPC', async () => {
    const response = await GET(
      createRequest('http://localhost/api/admin/merchants?sortBy=orders')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ merchant_id: merchantOneId });
    expect(mockCreateClient.mock.results[0]?.value).toBeTruthy();
    expect(body.generatedAt).toBeTypeOf('string');
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'merchants.read'
    );
  });
});
