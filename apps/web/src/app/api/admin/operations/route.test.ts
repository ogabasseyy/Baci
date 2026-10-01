import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAdminOperations = vi.fn();
const mockGetPlatformAdminAuth = vi.fn();
const mockCreateClient = vi.fn();

vi.mock('@/lib/admin-operations', () => ({
  getAdminOperations: (...args: unknown[]) => mockGetAdminOperations(...args),
}));
vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuth(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

import { GET } from './route';

function request(url: string): NextRequest {
  return new Request(url) as NextRequest;
}

describe('/api/admin/operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformAdminAuth.mockResolvedValue({
      context: { permissions: ['operations.read'], role: 'support' },
      status: 'authenticated',
      user: { email: 'admin@baci.test', id: 'admin-1' },
    });
    mockCreateClient.mockResolvedValue({});
    mockGetAdminOperations.mockResolvedValue({
      data: { summary: { notifications: 0 } },
      error: null,
    });
  });

  it('rejects unauthenticated callers before parsing or reading operations', async () => {
    mockGetPlatformAdminAuth.mockResolvedValue({ status: 'unauthenticated' });
    const response = await GET(
      request('http://localhost/api/admin/operations')
    );

    expect(response.status).toBe(401);
    expect(mockGetAdminOperations).not.toHaveBeenCalled();
  });

  it('rejects invalid bounded query input', async () => {
    const response = await GET(
      request('http://localhost/api/admin/operations?limit=101')
    );

    expect(response.status).toBe(400);
    expect(mockGetAdminOperations).not.toHaveBeenCalled();
  });

  it('runs the authenticated RPC with validated filters only', async () => {
    const response = await GET(
      request('http://localhost/api/admin/operations?section=shipping&limit=10')
    );

    expect(response.status).toBe(200);
    expect(mockGetPlatformAdminAuth).toHaveBeenCalledWith('operations.read');
    expect(mockGetAdminOperations).toHaveBeenCalledWith(
      {},
      {
        limit: 10,
        offset: 0,
        section: 'shipping',
      }
    );
    expect(await response.json()).toMatchObject({
      capabilities: { canReadFinancials: false, canReplay: false },
    });
  });

  it('advertises replay only to operations managers', async () => {
    mockGetPlatformAdminAuth.mockResolvedValue({
      context: {
        permissions: [
          'financials.read',
          'operations.read',
          'operations.manage',
        ],
        role: 'operations',
      },
      status: 'authenticated',
      user: { email: 'operator@baci.test', id: 'operator-1' },
    });

    const response = await GET(
      request('http://localhost/api/admin/operations')
    );

    expect(await response.json()).toMatchObject({
      capabilities: { canReadFinancials: true, canReplay: true },
    });
  });
});
