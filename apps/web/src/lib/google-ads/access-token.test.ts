import { describe, expect, it } from 'vitest';
import { resolveGoogleAdsAccessToken } from './access-token';
import { encryptGoogleAdsSecret } from './crypto';

const oauthConfig = {
  clientId: 'client',
  clientSecret: 'secret',
  oauthStateSecret: 'a'.repeat(32),
  redirectUri: 'https://usebaci.com/api/integrations/ads/google/callback',
  tokenEncryptionKey: Buffer.alloc(32, 7).toString('base64url'),
};

describe('resolveGoogleAdsAccessToken', () => {
  it('fails closed when a refresh token is unavailable', async () => {
    await expect(
      resolveGoogleAdsAccessToken(
        {
          access_token_ciphertext: null,
          refresh_token_ciphertext: null,
          token_expires_at: null,
        },
        oauthConfig
      )
    ).rejects.toThrow('GOOGLE_ADS_REFRESH_TOKEN_MISSING');
  });

  it('decrypts an unexpired access token without refreshing it', async () => {
    const ciphertext = encryptGoogleAdsSecret(
      'access-token',
      oauthConfig.tokenEncryptionKey
    );
    await expect(
      resolveGoogleAdsAccessToken(
        {
          access_token_ciphertext: ciphertext,
          refresh_token_ciphertext: null,
          token_expires_at: new Date(Date.now() + 300_000).toISOString(),
        },
        oauthConfig
      )
    ).resolves.toMatchObject({
      accessToken: 'access-token',
      encryptedAccessToken: null,
    });
  });
});
