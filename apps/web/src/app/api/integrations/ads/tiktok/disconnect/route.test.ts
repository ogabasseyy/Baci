import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const csrf = vi.fn();
const access = vi.fn();
const permission = vi.fn();
const invalidate = vi.hoisted(() => vi.fn());
const credentialRpc = vi.hoisted(() => vi.fn());
const createAdsCredentialServiceClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => authenticate(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => csrf(...args),
}));
vi.mock('@/lib/ads/analytics-cache', () => ({
  invalidateAdsAnalyticsCache: (...args: unknown[]) => invalidate(...args),
}));
vi.mock('@/lib/ads/server-credential-client', () => ({
  createAdsCredentialServiceClient: (...args: unknown[]) => {
    createAdsCredentialServiceClient(...args);
    return { rpc: credentialRpc };
  },
}));

import { DELETE } from './route';

describe('TikTok Ads disconnect route', () => {
  it('requires authentication before the CSRF-protected mutation', async () => {
    authenticate.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await DELETE(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/tiktok/disconnect',
            { method: 'DELETE' }
          )
        )
      ).status
    ).toBe(401);
  });

  it('rejects a mutation with a missing CSRF token after authentication', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    csrf.mockResolvedValue({ valid: false });
    expect(
      (
        await DELETE(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/tiktok/disconnect',
            { method: 'DELETE' }
          )
        )
      ).status
    ).toBe(403);
  });

  it('treats an already-missing connection as successfully disconnected', async () => {
    const rpc = vi.fn();
    credentialRpc.mockResolvedValue({ data: false, error: null });
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: true });
    const response = await DELETE(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/disconnect',
        { method: 'DELETE' }
      )
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connected: false });
    expect(credentialRpc).toHaveBeenCalledWith(
      'delete_merchant_ads_connection',
      {
        p_merchant_id: 'merchant',
        p_provider: 'tiktok_ads',
      }
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'delete_merchant_ads_connection',
      expect.anything()
    );
    expect(invalidate).toHaveBeenCalledWith('merchant');
  });
});
