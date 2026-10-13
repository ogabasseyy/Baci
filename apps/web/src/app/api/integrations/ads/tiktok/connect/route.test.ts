import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const access = vi.fn();
const permission = vi.fn();
const rpc = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => authenticate(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));
vi.mock('@/lib/ads/crypto', () => ({ generateAdsRandomValue: () => 'nonce' }));
vi.mock('@/lib/ads/state', () => ({
  createAdsOAuthState: () => 'signed-state',
}));
vi.mock('@/lib/ads/tiktok/config', () => ({
  getTikTokAdsConfig: () => ({
    authorizationUrl: 'https://business-api.tiktok.com/portal/authorize',
    oauthStateSecret: 'state-secret',
    redirectUri: 'https://usebaci.com/api/integrations/ads/tiktok/callback',
  }),
  TIKTOK_ADS_CONFIG_MISSING: 'TikTok Ads integration is not configured',
  TikTokAdsConfigError: class TikTokAdsConfigError extends Error {},
}));
vi.mock('@/lib/ads/tiktok/oauth', () => ({
  buildTikTokAdsAuthorizationUrl: () =>
    'https://business-api.tiktok.com/portal/authorize?state=signed-state',
}));

import { GET } from './route';

describe('TikTok Ads connect route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: true, error: null });
  });

  it('denies OAuth before state generation when unauthenticated', async () => {
    authenticate.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/tiktok/connect'
          )
        )
      ).status
    ).toBe(401);
  });

  it('rejects an authenticated user without integrations manage permission', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(false);
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/tiktok/connect'
          )
        )
      ).status
    ).toBe(403);
  });

  it('redirects an authorized merchant with an HttpOnly signed-state cookie', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/tiktok/connect')
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(
      'business-api.tiktok.com'
    );
    expect(response.headers.get('set-cookie')).toContain(
      'baci_tiktok_ads_oauth_state=signed-state'
    );
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie.match(/baci_tiktok_ads_oauth_state=/g) ?? []).toHaveLength(
      1
    );
    expect(rpc).toHaveBeenCalledWith(
      'reserve_merchant_ads_oauth_state_nonce',
      expect.objectContaining({ p_nonce: 'nonce', p_provider: 'tiktok_ads' })
    );
  });

  it('returns a readable authorization URL for same-origin dashboard fetches', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/connect',
        {
          headers: { accept: 'application/json' },
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({
      authorizationUrl:
        'https://business-api.tiktok.com/portal/authorize?state=signed-state',
    });
    expect(response.headers.get('set-cookie')).toContain(
      'baci_tiktok_ads_oauth_state=signed-state'
    );
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie.match(/baci_tiktok_ads_oauth_state=/g) ?? []).toHaveLength(
      1
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not redirect if the signed state nonce cannot be reserved', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    rpc.mockResolvedValueOnce({ data: false, error: null });

    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/tiktok/connect')
    );

    expect(response.status).toBe(503);
  });
});
