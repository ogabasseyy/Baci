import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const compare = vi.fn();
const access = vi.fn();
const permission = vi.fn();
const rpc = vi.fn();
const resolveMerchant = vi.fn();
const invalidate = vi.hoisted(() => vi.fn());
const credentialRpc = vi.hoisted(() => vi.fn());
const createAdsCredentialServiceClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => authenticate(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));
vi.mock('@/lib/ads/merchant-context', () => ({
  resolveAdsMerchantAccess: (...args: unknown[]) => resolveMerchant(...args),
}));
vi.mock('@/lib/ads/analytics-cache', () => ({
  invalidateAdsAnalyticsCache: (...args: unknown[]) => invalidate(...args),
}));
const verifyState = vi.fn();
vi.mock('@/lib/ads/state', () => ({
  verifyAdsOAuthState: (...args: unknown[]) => verifyState(...args),
}));
const exchange = vi.fn();
vi.mock('@/lib/ads/tiktok/oauth', () => ({
  exchangeTikTokAdsAuthorizationCode: (...args: unknown[]) => exchange(...args),
  TikTokAdsOAuthError: class TikTokAdsOAuthError extends Error {},
}));
const encrypt = vi.fn<(token: string, key: string, provider: string) => string>(
  () => 'v2.tiktok_ads.iv.tag.ciphertext'
);
vi.mock('@/lib/ads/crypto', () => ({
  encryptAdsToken: (token: string, key: string, provider: string) =>
    encrypt(token, key, provider),
  timingSafeStringEqual: (...args: unknown[]) => compare(...args),
}));
vi.mock('@/lib/ads/tiktok/config', () => ({
  getTikTokAdsConfig: () => ({
    appId: 'app',
    appSecret: 'secret',
    authorizationUrl: 'https://business-api.tiktok.com/portal/authorize',
    oauthStateSecret: 'a'.repeat(32),
    redirectUri: 'https://usebaci.com/api/integrations/ads/tiktok/callback',
    tokenEncryptionKey: 'key',
  }),
  TikTokAdsConfigError: class TikTokAdsConfigError extends Error {},
}));
vi.mock('@/lib/ads/server-credential-client', () => ({
  createAdsCredentialServiceClient: (...args: unknown[]) => {
    createAdsCredentialServiceClient(...args);
    return { rpc: credentialRpc };
  },
}));

import { GET } from './route';

describe('TikTok Ads callback route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialRpc.mockResolvedValue({ data: true, error: null });
    resolveMerchant.mockResolvedValue({
      access: { merchantId: 'merchant' },
      response: null,
    });
  });

  it('rejects state replay/mismatch and never reflects an attacker callback host', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    compare.mockReturnValue(false);
    const response = await GET(
      new NextRequest(
        'https://evil.example/api/integrations/ads/tiktok/callback?state=state&code=code',
        { headers: { cookie: 'baci_tiktok_ads_oauth_state=stored' } }
      )
    );
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/dashboard/analytics?category=ads&tiktok_ads=error&reason=invalid_state'
    );
  });

  it('rejects a state-validated callback that omitted the required reporting scopes', async () => {
    const merchantId = 'merchant-selected';
    const rpc = vi.fn((name: string) => {
      if (name === 'consume_merchant_ads_oauth_state_nonce')
        return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    access.mockResolvedValue({ merchantId });
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({ merchantId, nonce: 'nonce' });
    resolveMerchant.mockResolvedValueOnce({
      access: { merchantId },
      response: null,
    });
    exchange.mockResolvedValue({
      accessToken: 'token',
      advertiserIds: ['opaque-001'],
      scopes: ['100'],
    });
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/callback?state=state&code=code',
        { headers: { cookie: 'baci_tiktok_ads_oauth_state=state' } }
      )
    );
    expect(response.headers.get('location')).toContain(
      'reason=required_scopes_missing'
    );
    expect(response.headers.get('location')).toContain(
      `merchantId=${merchantId}`
    );
  });

  it('preserves the signed merchant when TikTok denies access', async () => {
    const merchantId = 'merchant-selected';
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({ merchantId, nonce: 'nonce' });
    resolveMerchant.mockResolvedValueOnce({
      access: { merchantId },
      response: null,
    });
    rpc.mockResolvedValue({ data: true, error: null });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/callback?state=state&error=access_denied',
        { headers: { cookie: 'baci_tiktok_ads_oauth_state=state' } }
      )
    );

    expect(response.headers.get('location')).toBe(
      `https://usebaci.com/dashboard/analytics?category=ads&tiktok_ads=error&reason=provider_denied&merchantId=${merchantId}`
    );
    expect(exchange).not.toHaveBeenCalled();
  });

  it('preserves the signed merchant when TikTok token exchange fails', async () => {
    const merchantId = 'merchant-selected';
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({ merchantId, nonce: 'nonce' });
    resolveMerchant.mockResolvedValueOnce({
      access: { merchantId },
      response: null,
    });
    rpc.mockResolvedValue({ data: true, error: null });
    exchange.mockRejectedValueOnce(new Error('provider failed'));

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/callback?state=state&code=code',
        { headers: { cookie: 'baci_tiktok_ads_oauth_state=state' } }
      )
    );

    expect(response.headers.get('location')).toBe(
      `https://usebaci.com/dashboard/analytics?category=ads&tiktok_ads=error&reason=token_exchange_failed&merchantId=${merchantId}`
    );
  });

  it('accepts exact state and required scopes then persists only encrypted token metadata', async () => {
    const rpc = vi.fn((name: string) => {
      if (name === 'consume_merchant_ads_oauth_state_nonce')
        return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({ merchantId: 'merchant' });
    exchange.mockResolvedValue({
      accessToken: 'token',
      advertiserIds: ['opaque-001'],
      scopes: ['44', '100'],
    });
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/callback?state=state&code=code',
        { headers: { cookie: 'baci_tiktok_ads_oauth_state=state' } }
      )
    );
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('category')).toBe('ads');
    expect(location.searchParams.get('tiktok_ads')).toBe('connected');
    expect(location.searchParams.get('cacheBust')).toMatch(/^\d{1,10}$/);
    expect(encrypt).toHaveBeenCalledWith('token', 'key', 'tiktok_ads');
    expect(credentialRpc).toHaveBeenCalledWith(
      'upsert_merchant_ads_connection',
      expect.objectContaining({
        p_access_token_ciphertext: 'v2.tiktok_ads.iv.tag.ciphertext',
        p_refresh_token_ciphertext: null,
        p_scopes: ['44', '100'],
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'upsert_merchant_ads_connection',
      expect.anything()
    );
    expect(invalidate).toHaveBeenCalledWith('merchant');
  });

  it('rejects a consumed state before exchanging a replayed authorization code', async () => {
    const merchantId = 'merchant-selected';
    const rpc = vi.fn((name: string) => {
      if (name === 'consume_merchant_ads_oauth_state_nonce')
        return Promise.resolve({ data: false, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    access.mockResolvedValue({ merchantId });
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({ merchantId, nonce: 'nonce' });
    resolveMerchant.mockResolvedValueOnce({
      access: { merchantId },
      response: null,
    });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/callback?state=state&code=code',
        { headers: { cookie: 'baci_tiktok_ads_oauth_state=state' } }
      )
    );

    expect(response.headers.get('location')).toContain('reason=invalid_state');
    expect(response.headers.get('location')).toContain(
      `merchantId=${merchantId}`
    );
    expect(exchange).not.toHaveBeenCalled();
  });
});
