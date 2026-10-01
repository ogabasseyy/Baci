import { type NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckCsrfProtection = vi.fn();
const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockRevalidateAnalytics = vi.fn();

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateAnalytics: (...args: unknown[]) => mockRevalidateAnalytics(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));

function createRefreshRequest(init: RequestInit = {}): NextRequest {
  return new Request('http://localhost/api/admin/analytics', {
    method: 'POST',
    ...init,
  }) as unknown as NextRequest;
}

import { POST } from './route';

describe('/api/admin/analytics route POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      context: { permissions: ['analytics.read'], role: 'viewer' },
      status: 'authenticated',
      user: { email: 'viewer@example.com', id: 'membership-only-viewer' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  });

  it('returns 403 when CSRF validation fails on POST', async () => {
    mockCheckCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
    });

    const response = await POST(createRefreshRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Invalid CSRF token');
  });

  it.each([
    {
      arrange: () => {
        mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
          status: 'unauthenticated',
        });
      },
      error: 'Unauthorized',
      name: 'returns 401 when the user is not authenticated on POST',
      status: 401,
    },
    {
      arrange: () => {
        mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
          status: 'forbidden',
        });
      },
      error: 'Forbidden',
      name: 'returns 403 when the user lacks analytics.read on POST',
      status: 403,
    },
  ])('$name', async ({ arrange, error, status }) => {
    arrange();

    const response = await POST(createRefreshRequest());
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.error).toBe(error);
  });

  it('reloads live analytics without a materialized-view or service-role RPC', async () => {
    const response = await POST(createRefreshRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'analytics.read'
    );
    expect(mockRevalidateAnalytics).toHaveBeenCalledTimes(1);
    expect(body.message).toBe('Live platform analytics reloaded successfully');
  });
});
