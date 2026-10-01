import { describe, expect, it, vi } from 'vitest';
import {
  buildMetaAdsAuthorizationUrl,
  exchangeMetaAdsAuthorizationCode,
  exchangeMetaAdsLongLivedToken,
  type MetaAdsOAuthError,
} from './oauth';

const config = {
  appId: 'app-id',
  appSecret: 'app-secret',
  redirectUri: 'https://usebaci.com/api/integrations/ads/meta/callback',
};

describe('Meta Ads OAuth', () => {
  it('uses v25.0, ads_read only, and the exact callback', () => {
    const url = new URL(buildMetaAdsAuthorizationUrl(config, 'signed-state'));
    expect(url.origin + url.pathname).toBe(
      'https://www.facebook.com/v25.0/dialog/oauth'
    );
    expect(url.searchParams.get('scope')).toBe('ads_read');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  });

  it('exchanges code server-side and then requests a long-lived token', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'access', expires_in: 3600 }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'access', expires_in: 3600 }),
          { status: 200 }
        )
      );
    await expect(
      exchangeMetaAdsAuthorizationCode({ ...config, code: 'code' }, fetchImpl)
    ).resolves.toMatchObject({ access_token: 'access' });
    await expect(
      exchangeMetaAdsLongLivedToken(
        { ...config, accessToken: 'access' },
        fetchImpl
      )
    ).resolves.toMatchObject({ access_token: 'access' });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      'grant_type=fb_exchange_token'
    );
  });

  it('rejects a long-lived token response without an expiry', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'long-lived' }), {
        status: 200,
      })
    );

    await expect(
      exchangeMetaAdsLongLivedToken(
        { ...config, accessToken: 'short-lived' },
        fetchImpl
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<MetaAdsOAuthError>>({
        code: 'META_ADS_TOKEN_RESPONSE_INVALID',
      })
    );
  });
});
