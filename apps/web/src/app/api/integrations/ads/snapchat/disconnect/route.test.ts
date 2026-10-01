import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.fn();
const access = vi.fn();
const permission = vi.fn();
const csrf = vi.fn();
const invalidate = vi.hoisted(() => vi.fn());
const credentialRpc = vi.hoisted(() => vi.fn());
const createAdsCredentialServiceClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => auth(...args),
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

describe('Snapchat Ads disconnect route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies unauthenticated deletion before CSRF or RPC work', async () => {
    auth.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await DELETE(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/disconnect',
            { method: 'DELETE' }
          )
        )
      ).status
    ).toBe(401);
  });

  it('treats an already-missing connection as successfully disconnected', async () => {
    const rpc = vi.fn();
    credentialRpc.mockResolvedValue({ data: false, error: null });
    auth.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: true });
    await expect(
      DELETE(
        new NextRequest(
          'https://usebaci.com/api/integrations/ads/snapchat/disconnect',
          { method: 'DELETE' }
        )
      )
    ).resolves.toMatchObject({ status: 200 });
    expect(credentialRpc).toHaveBeenCalledWith(
      'delete_merchant_ads_connection',
      { p_merchant_id: 'merchant', p_provider: 'snapchat_ads' }
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'delete_merchant_ads_connection',
      expect.anything()
    );
    expect(invalidate).toHaveBeenCalledWith('merchant');
  });

  it('rejects invalid CSRF before permission or RPC work', async () => {
    auth.mockResolvedValue({
      error: null,
      supabase: { rpc: vi.fn() },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: false });
    expect(
      (
        await DELETE(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/disconnect',
            { method: 'DELETE' }
          )
        )
      ).status
    ).toBe(403);
  });

  it('denies permissions and hides RPC failure sentinels', async () => {
    const rpc = vi.fn();
    credentialRpc.mockResolvedValue({
      data: false,
      error: { message: 'SNAP_DISCONNECT_SENTINEL' },
    });
    auth.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    csrf.mockResolvedValue({ valid: true });
    permission.mockReturnValue(false);
    const forbidden = await DELETE(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/disconnect',
        { method: 'DELETE' }
      )
    );
    expect(forbidden.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();

    permission.mockReturnValue(true);
    const failure = await DELETE(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/disconnect',
        { method: 'DELETE' }
      )
    );
    expect(failure.status).toBe(500);
    expect(credentialRpc).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalledWith(
      'delete_merchant_ads_connection',
      expect.anything()
    );
    expect(JSON.stringify(await failure.json())).not.toContain(
      'SNAP_DISCONNECT_SENTINEL'
    );
  });
});
