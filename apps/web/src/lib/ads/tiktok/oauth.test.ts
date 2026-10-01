import { describe, expect, it, vi } from 'vitest';
import {
  buildTikTokAdsAuthorizationUrl,
  exchangeTikTokAdsAuthorizationCode,
} from './oauth';

describe('TikTok Ads OAuth', () => {
  it('uses the approved callback and does not expose the app secret in the authorization URL', () => {
    const url = new URL(
      buildTikTokAdsAuthorizationUrl(
        {
          appId: 'configured-app-id',
          authorizationUrl: 'https://business-api.tiktok.com/portal/authorize',
          redirectUri:
            'https://usebaci.com/api/integrations/ads/tiktok/callback',
        },
        'state'
      )
    );
    expect(url.searchParams.get('app_id')).toBe('configured-app-id');
    expect(url.searchParams.get('state')).toBe('state');
    expect(url.search).not.toContain('secret');
  });

  it('preserves preconfigured parameters while binding the configured app ID', () => {
    const url = new URL(
      buildTikTokAdsAuthorizationUrl(
        {
          appId: 'configured-app-id',
          authorizationUrl:
            'https://business-api.tiktok.com/portal/authorize?app_id=preconfigured-app-id&locale=en-US',
          redirectUri:
            'https://usebaci.com/api/integrations/ads/tiktok/callback',
        },
        'state'
      )
    );

    expect(url.searchParams.get('app_id')).toBe('configured-app-id');
    expect(url.searchParams.get('locale')).toBe('en-US');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://usebaci.com/api/integrations/ads/tiktok/callback'
    );
    expect(url.searchParams.get('state')).toBe('state');
  });
  it('reads long-lived grants without a refresh-token assumption', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            access_token: 'token',
            advertiser_ids: ['opaque-id'],
            scope: [44, 100],
          },
        })
      )
    );
    const acquire = vi.fn().mockResolvedValue(undefined);
    await expect(
      exchangeTikTokAdsAuthorizationCode(
        { appId: 'app', appSecret: 'secret', code: 'code' },
        fetchImpl,
        acquire
      )
    ).resolves.toEqual({
      accessToken: 'token',
      advertiserIds: ['opaque-id'],
      scopes: ['44', '100'],
    });
    expect(acquire).toHaveBeenCalledOnce();
  });
});
