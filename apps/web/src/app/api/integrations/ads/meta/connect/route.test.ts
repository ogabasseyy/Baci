import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const access = vi.fn();
const permission = vi.fn();
const rpc = vi.fn();
const createState = vi.fn<(payload: unknown, secret: string) => string>(
  () => 'signed-state'
);
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => authenticate(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));
vi.mock('@/lib/ads/crypto', () => ({
  generateAdsRandomValue: () => 'a'.repeat(24),
}));
vi.mock('@/lib/ads/meta/config', () => ({
  getMetaAdsConfig: () => ({
    oauthStateSecret: 'state-secret',
    redirectUri: 'https://usebaci.com/api/integrations/ads/meta/callback',
  }),
  META_ADS_CONFIG_MISSING: 'Meta Ads integration is not configured',
  MetaAdsConfigError: class MetaAdsConfigError extends Error {},
}));
vi.mock('@/lib/ads/meta/oauth', () => ({
  buildMetaAdsAuthorizationUrl: () => 'https://facebook.com/oauth',
}));
vi.mock('@/lib/ads/state', () => ({
  createAdsOAuthState: (payload: unknown, secret: string) =>
    createState(payload, secret),
}));

import { GET } from './route';

describe('Meta Ads connect route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    rpc.mockResolvedValue({ data: true, error: null });
    createState.mockReturnValue('signed-state');
  });

  it('rejects unauthenticated requests before OAuth state generation', async () => {
    authenticate.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/meta/connect'
          )
        )
      ).status
    ).toBe(401);
  });

  it('reserves its signed state nonce before redirecting to Meta', async () => {
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/connect')
    );

    expect(response.status).toBe(307);
    expect(rpc).toHaveBeenCalledWith(
      'reserve_merchant_ads_oauth_state_nonce',
      expect.objectContaining({
        p_nonce: 'a'.repeat(24),
        p_provider: 'meta_ads',
      })
    );
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie.match(/baci_meta_ads_oauth_state=/g) ?? []).toHaveLength(
      1
    );
  });

  it('returns a readable authorization URL for same-origin dashboard fetches', async () => {
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/connect', {
        headers: { accept: 'application/json' },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({
      authorizationUrl: 'https://facebook.com/oauth',
    });
    expect(response.headers.get('set-cookie')).toContain(
      'baci_meta_ads_oauth_state='
    );
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie.match(/baci_meta_ads_oauth_state=/g) ?? []).toHaveLength(
      1
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not redirect when nonce reservation is rejected', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });

    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/connect')
    );

    expect(response.status).toBe(503);
  });

  it('binds OAuth state and nonce reservation to the explicitly selected merchant', async () => {
    const ownerQuery = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          business_name: 'Selected merchant',
          id: '550e8400-e29b-41d4-a716-446655440000',
          slug: 'selected',
        },
        error: null,
      }),
      select: vi.fn().mockReturnThis(),
    };
    authenticate.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn().mockReturnValue(ownerQuery), rpc },
      user: { id: 'user' },
    });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/connect?merchantId=550e8400-e29b-41d4-a716-446655440000'
      )
    );

    expect(response.status).toBe(307);
    expect(createState).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: '550e8400-e29b-41d4-a716-446655440000',
      }),
      'state-secret'
    );
    expect(rpc).toHaveBeenCalledWith(
      'reserve_merchant_ads_oauth_state_nonce',
      expect.objectContaining({
        p_merchant_id: '550e8400-e29b-41d4-a716-446655440000',
      })
    );
  });
});
