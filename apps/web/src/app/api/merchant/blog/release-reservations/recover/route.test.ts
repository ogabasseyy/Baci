import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAuthenticateApiRequest,
  mockCheckCsrfProtection,
  mockHasPermission,
  mockResolveSelectedMerchantAccess,
} = vi.hoisted(() => ({
  mockAuthenticateApiRequest: vi.fn(),
  mockCheckCsrfProtection: vi.fn(),
  mockHasPermission: vi.fn(),
  mockResolveSelectedMerchantAccess: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mockAuthenticateApiRequest,
  hasPermission: mockHasPermission,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mockCheckCsrfProtection,
}));

vi.mock('@/app/api/merchant/features/resolve-selected-merchant-access', () => ({
  resolveSelectedMerchantAccess: mockResolveSelectedMerchantAccess,
}));

import { POST } from './route';

describe('POST /api/merchant/blog/release-reservations/recover', () => {
  const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  const mockRpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: { rpc: mockRpc },
      user: { id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockResolveSelectedMerchantAccess.mockResolvedValue({
      access: { merchantId },
      invalidMerchantId: false,
    });
    mockHasPermission.mockReturnValue(true);
  });

  it('invokes recover_abandoned_blog_release_reservations_v1 for the authorized merchant', async () => {
    mockRpc.mockResolvedValue({
      data: {
        cancelled_abandoned_count: 1,
        preserved_scheduled_count: 2,
        reconciled_published_count: 0,
      },
      error: null,
    });

    const response = await POST(
      new NextRequest(
        'http://localhost/api/merchant/blog/release-reservations/recover',
        { method: 'POST' }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cancelled_abandoned_count: 1,
      preserved_scheduled_count: 2,
      reconciled_published_count: 0,
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'recover_abandoned_blog_release_reservations_v1',
      { p_merchant_id: merchantId }
    );
  });

  it('returns 401 when unauthenticated, 400 on invalid merchantId, and 500 on RPC error', async () => {
    mockAuthenticateApiRequest.mockResolvedValueOnce({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    const unauthRes = await POST(
      new NextRequest(
        'http://localhost/api/merchant/blog/release-reservations/recover',
        { method: 'POST' }
      )
    );
    expect(unauthRes.status).toBe(401);

    mockResolveSelectedMerchantAccess.mockResolvedValueOnce({
      access: null,
      invalidMerchantId: true,
    });
    const badMerchantRes = await POST(
      new NextRequest(
        'http://localhost/api/merchant/blog/release-reservations/recover?merchantId=bad',
        { method: 'POST' }
      )
    );
    expect(badMerchantRes.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'unexpected db failure' },
    });
    const rpcErrRes = await POST(
      new NextRequest(
        'http://localhost/api/merchant/blog/release-reservations/recover',
        { method: 'POST' }
      )
    );
    expect(rpcErrRes.status).toBe(500);
  });

  it('returns 403 when caller lacks marketing edit permission', async () => {
    mockHasPermission.mockReturnValue(false);

    const response = await POST(
      new NextRequest(
        'http://localhost/api/merchant/blog/release-reservations/recover',
        { method: 'POST' }
      )
    );

    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
