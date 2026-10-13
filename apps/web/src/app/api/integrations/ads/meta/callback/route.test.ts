import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const compare = vi.fn();
const access = vi.fn();
const permission = vi.fn();
const verifyState = vi.fn();
const rpc = vi.fn();
const credentialRpc = vi.fn();
const createAdsCredentialServiceClient = vi.fn();
const resolveMerchant = vi.fn();
const exchangeCode = vi.hoisted(() => vi.fn());
const exchangeLongLived = vi.hoisted(() => vi.fn());
const MetaAdsOAuthErrorMock = vi.hoisted(
  () =>
    class MetaAdsOAuthError extends Error {
      readonly code: string;

      constructor(code: string) {
        super(code);
        this.code = code;
      }
    }
);
const validateGrant = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => authenticate(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));
vi.mock('@/lib/ads/merchant-context', () => ({
  resolveAdsMerchantAccess: (...args: unknown[]) => resolveMerchant(...args),
}));
vi.mock('@/lib/ads/crypto', () => ({
  encryptAdsToken: vi.fn(),
  timingSafeStringEqual: (...args: unknown[]) => compare(...args),
}));
vi.mock('@/lib/ads/meta/config', () => ({
  getMetaAdsConfig: () => ({
    appId: 'app',
    appSecret: 'secret',
    oauthStateSecret: 'a'.repeat(32),
    redirectUri: 'https://usebaci.com/api/integrations/ads/meta/callback',
    tokenEncryptionKey: Buffer.alloc(32).toString('base64url'),
  }),
  MetaAdsConfigError: class MetaAdsConfigError extends Error {},
}));
vi.mock('@/lib/ads/state', () => ({
  verifyAdsOAuthState: (...args: unknown[]) => verifyState(...args),
}));
vi.mock('@/lib/ads/analytics-cache', () => ({
  invalidateAdsAnalyticsCache: (...args: unknown[]) => invalidate(...args),
}));
vi.mock('@/lib/ads/meta/oauth', () => ({
  MetaAdsOAuthError: MetaAdsOAuthErrorMock,
  exchangeMetaAdsAuthorizationCode: (...args: unknown[]) =>
    exchangeCode(...args),
  exchangeMetaAdsLongLivedToken: (...args: unknown[]) =>
    exchangeLongLived(...args),
}));
vi.mock('@/lib/ads/meta/provider', () => ({
  MetaAdsProviderError: class MetaAdsProviderError extends Error {},
  validateMetaAdsGrant: (...args: unknown[]) => validateGrant(...args),
}));
vi.mock('@/lib/ads/server-credential-client', () => ({
  createAdsCredentialServiceClient: (...args: unknown[]) => {
    createAdsCredentialServiceClient(...args);
    return { rpc: credentialRpc };
  },
}));

import { GET } from './route';

describe('Meta Ads callback route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialRpc.mockResolvedValue({ data: true, error: null });
    resolveMerchant.mockResolvedValue({
      access: { merchantId: 'merchant' },
      response: null,
    });
  });

  it('fails state mismatch without exchanging a code or reflecting the callback host', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    compare.mockReturnValue(false);
    const response = await GET(
      new NextRequest(
        'https://evil.example/api/integrations/ads/meta/callback?state=state&code=code',
        { headers: { cookie: 'baci_meta_ads_oauth_state=stored' } }
      )
    );
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/dashboard/analytics?category=ads&meta_ads=error&reason=invalid_state'
    );
  });

  it('fails a consumed state before exchanging a replayed authorization code', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({
      merchantId: 'merchant',
      nonce: 'n'.repeat(24),
    });
    rpc.mockResolvedValue({ data: false, error: null });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/callback?state=state&code=code',
        { headers: { cookie: 'baci_meta_ads_oauth_state=state' } }
      )
    );

    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/dashboard/analytics?category=ads&meta_ads=error&reason=invalid_state&merchantId=merchant'
    );
    expect(rpc).toHaveBeenCalledWith(
      'consume_merchant_ads_oauth_state_nonce',
      expect.objectContaining({ p_provider: 'meta_ads' })
    );
  });

  it('preserves the signed merchant when Meta denies access', async () => {
    const merchantId = 'merchant-selected';
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({ merchantId, nonce: 'n'.repeat(24) });
    resolveMerchant.mockResolvedValueOnce({
      access: { merchantId },
      response: null,
    });
    rpc.mockResolvedValue({ data: true, error: null });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/callback?state=state&error=access_denied',
        { headers: { cookie: 'baci_meta_ads_oauth_state=state' } }
      )
    );

    expect(response.headers.get('location')).toBe(
      `https://usebaci.com/dashboard/analytics?category=ads&meta_ads=error&reason=provider_denied&merchantId=${merchantId}`
    );
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('consumes OAuth state only for its signed selected merchant', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({
      merchantId: '550e8400-e29b-41d4-a716-446655440000',
      nonce: 'n'.repeat(24),
    });
    resolveMerchant.mockResolvedValue({
      access: { merchantId: '550e8400-e29b-41d4-a716-446655440000' },
      response: null,
    });
    rpc.mockResolvedValue({ data: false, error: null });

    await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/callback?state=state&code=code',
        { headers: { cookie: 'baci_meta_ads_oauth_state=state' } }
      )
    );

    expect(resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: '550e8400-e29b-41d4-a716-446655440000',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'consume_merchant_ads_oauth_state_nonce',
      expect.objectContaining({
        p_merchant_id: '550e8400-e29b-41d4-a716-446655440000',
      })
    );
  });

  it('invalidates the merchant analytics snapshots after a successful connection', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({
      merchantId: 'merchant',
      nonce: 'n'.repeat(24),
    });
    rpc.mockImplementation((name: string) => {
      if (name === 'consume_merchant_ads_oauth_state_nonce') {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });
    exchangeCode.mockResolvedValue({ access_token: 'short-lived' });
    exchangeLongLived.mockResolvedValue({
      access_token: 'long-lived',
      expires_in: 3600,
    });
    validateGrant.mockResolvedValue({ providerUserId: 'meta-user' });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/callback?state=state&code=code',
        { headers: { cookie: 'baci_meta_ads_oauth_state=state' } }
      )
    );

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('category')).toBe('ads');
    expect(location.searchParams.get('meta_ads')).toBe('connected');
    expect(location.searchParams.get('cacheBust')).toMatch(/^\d{1,10}$/);
    expect(credentialRpc).toHaveBeenCalledWith(
      'upsert_merchant_ads_connection',
      expect.anything()
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'upsert_merchant_ads_connection',
      expect.anything()
    );
    expect(invalidate).toHaveBeenCalledWith('merchant');
  });

  it('does not persist a connection when the long-lived token has no expiry', async () => {
    const merchantId = 'merchant-selected';
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    compare.mockReturnValue(true);
    permission.mockReturnValue(true);
    verifyState.mockReturnValue({
      merchantId,
      nonce: 'n'.repeat(24),
    });
    resolveMerchant.mockResolvedValueOnce({
      access: { merchantId },
      response: null,
    });
    rpc.mockResolvedValue({ data: true, error: null });
    exchangeCode.mockResolvedValue({ access_token: 'short-lived' });
    exchangeLongLived.mockRejectedValue(
      new MetaAdsOAuthErrorMock('META_ADS_TOKEN_RESPONSE_INVALID')
    );

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/callback?state=state&code=code',
        { headers: { cookie: 'baci_meta_ads_oauth_state=state' } }
      )
    );

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('category')).toBe('ads');
    expect(location.searchParams.get('meta_ads')).toBe('error');
    expect(location.searchParams.get('reason')).toBe(
      'meta_ads_token_response_invalid'
    );
    expect(location.searchParams.get('merchantId')).toBe(merchantId);
    expect(credentialRpc).not.toHaveBeenCalledWith(
      'upsert_merchant_ads_connection',
      expect.anything()
    );
    expect(invalidate).not.toHaveBeenCalled();
  });
});
