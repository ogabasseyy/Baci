import { describe, expect, it } from 'vitest';
import { encryptAdsToken } from '@/lib/ads/crypto';
import { resolveMetaAdsAccessToken } from './access-token';

describe('Meta Ads token resolution', () => {
  it('requires an unexpired v2 provider-bound token', () => {
    const key = Buffer.alloc(32).toString('base64url');
    const config = {
      appId: 'app',
      appSecret: 'secret',
      oauthStateSecret: 'a'.repeat(32),
      redirectUri: 'https://usebaci.com/api/integrations/ads/meta/callback',
      tokenEncryptionKey: key,
    };
    expect(
      resolveMetaAdsAccessToken(
        {
          access_token_ciphertext: encryptAdsToken('token', key, 'meta_ads'),
          token_expires_at: new Date(Date.now() + 120_000).toISOString(),
        },
        config
      )
    ).toBe('token');
    expect(() =>
      resolveMetaAdsAccessToken(
        {
          access_token_ciphertext: 'ciphertext',
          token_expires_at: new Date(Date.now() - 1).toISOString(),
        },
        config
      )
    ).toThrow('META_ADS_REAUTH_REQUIRED');
  });
});
