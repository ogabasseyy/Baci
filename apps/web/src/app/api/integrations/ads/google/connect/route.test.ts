import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockGetConfig = vi.fn();
const mockCreateState = vi.fn();
const mockCreatePkcePair = vi.fn();
const mockBuildUrl = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/google-ads/config', () => ({
  GOOGLE_ADS_CONFIG_MISSING: 'Google Ads integration is not configured',
  getGoogleAdsOAuthConfig: (...args: unknown[]) => mockGetConfig(...args),
}));
vi.mock('@/lib/google-ads/oauth', () => ({
  buildGoogleAdsAuthorizationUrl: (...args: unknown[]) => mockBuildUrl(...args),
  createGoogleAdsOAuthState: (...args: unknown[]) => mockCreateState(...args),
  createGoogleAdsPkcePair: (...args: unknown[]) => mockCreatePkcePair(...args),
}));

import { GET } from './route';

describe('GET /api/integrations/ads/google/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({
      error: null,
      supabase: { rpc: mockRpc },
      user: { id: 'user-1' },
    });
    mockGetUserAccess.mockResolvedValue({ merchantId: 'merchant-1' });
    mockHasPermission.mockReturnValue(true);
    mockGetConfig.mockReturnValue({
      clientId: 'client',
      clientSecret: 'secret',
      oauthStateSecret: 'state',
      redirectUri: 'https://usebaci.com/api/integrations/ads/google/callback',
      tokenEncryptionKey: 'key',
    });
    mockCreatePkcePair.mockReturnValue({
      challenge: 'challenge',
      verifier: 'verifier',
    });
    mockCreateState.mockReturnValue('signed-state');
    mockBuildUrl.mockReturnValue(
      'https://accounts.google.com/o/oauth2/v2/auth?state=signed-state'
    );
    mockRpc.mockResolvedValue({ data: true, error: null });
  });

  it('returns 401 before constructing OAuth state when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValueOnce({
      error: 'Not authenticated',
      supabase: null,
      user: null,
    });

    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/google/connect')
    );

    expect(response.status).toBe(401);
    expect(mockCreateState).not.toHaveBeenCalled();
  });

  it('redirects to Google with PKCE and merchant-bound cookies', async () => {
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/google/connect')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('accounts.google.com');
    expect(response.headers.get('set-cookie')).toContain(
      'baci_google_ads_oauth_state='
    );
    expect(response.headers.get('set-cookie')).toContain(
      'baci_google_ads_oauth_verifier='
    );
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie.match(/baci_google_ads_oauth_state=/g) ?? []).toHaveLength(
      1
    );
    expect(
      setCookie.match(/baci_google_ads_oauth_verifier=/g) ?? []
    ).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'reserve_merchant_ads_oauth_state_nonce',
      expect.objectContaining({
        p_nonce: 'verifier',
        p_provider: 'google_ads',
      })
    );
  });

  it('returns a readable authorization URL for same-origin dashboard fetches', async () => {
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/connect',
        {
          headers: { accept: 'application/json' },
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({
      authorizationUrl:
        'https://accounts.google.com/o/oauth2/v2/auth?state=signed-state',
    });
    expect(response.headers.get('set-cookie')).toContain(
      'baci_google_ads_oauth_state='
    );
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie.match(/baci_google_ads_oauth_state=/g) ?? []).toHaveLength(
      1
    );
    expect(
      setCookie.match(/baci_google_ads_oauth_verifier=/g) ?? []
    ).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the server cannot reserve the state nonce', async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null });

    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/google/connect')
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
  });
});
