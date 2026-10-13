import { describe, expect, it, vi } from 'vitest';
import {
  buildSnapchatAdsAuthorizationUrl,
  exchangeSnapchatAdsAuthorizationCode,
} from './oauth';

describe('Snapchat Ads OAuth', () => {
  it('uses the documented scope and exact canonical callback without PKCE parameters', () => {
    const url = new URL(
      buildSnapchatAdsAuthorizationUrl(
        {
          clientId: 'client',
          redirectUri:
            'https://usebaci.com/api/integrations/ads/snapchat/callback',
        },
        'signed-state'
      )
    );
    expect(url.origin + url.pathname).toBe(
      'https://accounts.snapchat.com/login/oauth2/authorize'
    );
    expect(url.searchParams.get('scope')).toBe('snapchat-marketing-api');
    expect(url.searchParams.get('code_challenge')).toBeNull();
  });
  it('rejects malformed token responses without returning their body', async () => {
    await expect(
      exchangeSnapchatAdsAuthorizationCode(
        {
          clientId: 'client',
          clientSecret: 'secret',
          code: 'code',
          redirectUri:
            'https://usebaci.com/api/integrations/ads/snapchat/callback',
        },
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response(JSON.stringify({ access_token: 'token' }))
          )
      )
    ).rejects.toMatchObject({ code: 'SNAPCHAT_ADS_TOKEN_RESPONSE_INVALID' });
  });

  it('uses the originally requested scope when the token response omits scope', async () => {
    const grant = await exchangeSnapchatAdsAuthorizationCode(
      {
        clientId: 'client',
        clientSecret: 'secret',
        code: 'code',
        redirectUri:
          'https://usebaci.com/api/integrations/ads/snapchat/callback',
      },
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'access',
            expires_in: 3600,
            refresh_token: 'refresh',
          })
        )
      )
    );

    expect(grant.scopes).toEqual(['snapchat-marketing-api']);
  });

  it('preserves an explicit token-response scope for callback validation', async () => {
    const grant = await exchangeSnapchatAdsAuthorizationCode(
      {
        clientId: 'client',
        clientSecret: 'secret',
        code: 'code',
        redirectUri:
          'https://usebaci.com/api/integrations/ads/snapchat/callback',
      },
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'access',
            expires_in: 3600,
            refresh_token: 'refresh',
            scope: 'unexpected-scope',
          })
        )
      )
    );

    expect(grant.scopes).toEqual(['unexpected-scope']);
  });
});
