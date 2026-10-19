import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptAdsToken } from '@/lib/ads/crypto';

const refresh = vi.fn();
vi.mock('./oauth', () => ({
  refreshSnapchatAdsAccessToken: (...args: unknown[]) => refresh(...args),
}));

import {
  getSnapchatAdsUsableAccessToken,
  getSnapchatAdsUsableGrant,
  resolveSnapchatAdsAccessToken,
} from './access-token';

const tokenEncryptionKey = Buffer.alloc(32, 6).toString('base64url');
const config = {
  clientId: 'client',
  clientSecret: 'secret',
  oauthStateSecret: 'state'.repeat(8),
  redirectUri: 'https://usebaci.com/api/integrations/ads/snapchat/callback',
  tokenEncryptionKey,
};

describe('Snapchat Ads access token', () => {
  beforeEach(() => {
    refresh.mockReset();
  });

  it('requires a stored encrypted access token', () => {
    expect(() =>
      resolveSnapchatAdsAccessToken(
        {
          access_token_ciphertext: null,
          refresh_token_ciphertext: null,
          token_expires_at: null,
        },
        {} as never
      )
    ).toThrow('SNAPCHAT_ADS_REAUTH_REQUIRED');
  });

  it('atomically replaces both encrypted tokens after a successful refresh', async () => {
    const oldRefreshCiphertext = encryptAdsToken(
      'old-refresh',
      tokenEncryptionKey,
      'snapchat_ads'
    );
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    refresh.mockResolvedValue({
      accessToken: 'new-access',
      expiresIn: 3600,
      refreshToken: 'new-refresh',
      scopes: ['snapchat-marketing-api'],
    });
    await expect(
      getSnapchatAdsUsableAccessToken({
        config,
        connection: {
          access_token_ciphertext: encryptAdsToken(
            'old-access',
            tokenEncryptionKey,
            'snapchat_ads'
          ),
          refresh_token_ciphertext: oldRefreshCiphertext,
          token_expires_at: '2020-01-01T00:00:00Z',
        },
        merchantId: 'merchant',
        credentialSupabase: { rpc } as never,
      })
    ).resolves.toBe('new-access');
    expect(rpc).toHaveBeenCalledWith(
      'update_snapchat_ads_connection_tokens',
      expect.objectContaining({
        p_current_refresh_token_ciphertext: oldRefreshCiphertext,
        p_refresh_token_ciphertext: expect.not.stringContaining('new-refresh'),
      })
    );
  });

  it('refreshes a legacy connection when its access token ciphertext is missing', async () => {
    const refreshCiphertext = encryptAdsToken(
      'stored-refresh',
      tokenEncryptionKey,
      'snapchat_ads'
    );
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    refresh.mockResolvedValue({
      accessToken: 'recovered-access',
      expiresIn: 3600,
      refreshToken: 'rotated-refresh',
      scopes: [],
    });

    await expect(
      getSnapchatAdsUsableGrant({
        config,
        connection: {
          access_token_ciphertext: null,
          refresh_token_ciphertext: refreshCiphertext,
          token_expires_at: null,
        },
        merchantId: 'merchant',
        credentialSupabase: { rpc } as never,
      })
    ).resolves.toMatchObject({ accessToken: 'recovered-access' });
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'stored-refresh' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'update_snapchat_ads_connection_tokens',
      expect.objectContaining({
        p_current_refresh_token_ciphertext: refreshCiphertext,
      })
    );
  });

  it.each([
    ['missing expiry', null],
    ['malformed expiry', 'not-a-date'],
  ])('refreshes an encrypted grant when expiry metadata is %s', async (_label, tokenExpiresAt) => {
    const refreshCiphertext = encryptAdsToken(
      'stored-refresh',
      tokenEncryptionKey,
      'snapchat_ads'
    );
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    refresh.mockResolvedValue({
      accessToken: 'recovered-access',
      expiresIn: 3600,
      refreshToken: 'rotated-refresh',
      scopes: [],
    });

    await expect(
      getSnapchatAdsUsableGrant({
        config,
        connection: {
          access_token_ciphertext: encryptAdsToken(
            'stored-access',
            tokenEncryptionKey,
            'snapchat_ads'
          ),
          refresh_token_ciphertext: refreshCiphertext,
          token_expires_at: tokenExpiresAt,
        },
        merchantId: 'merchant',
        credentialSupabase: { rpc } as never,
      })
    ).resolves.toMatchObject({ accessToken: 'recovered-access' });
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'stored-refresh' })
    );
  });

  it('refreshes an expired grant without decrypting its stale access ciphertext', async () => {
    const refreshCiphertext = encryptAdsToken(
      'stored-refresh',
      tokenEncryptionKey,
      'snapchat_ads'
    );
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    refresh.mockResolvedValue({
      accessToken: 'recovered-access',
      expiresIn: 3600,
      refreshToken: 'rotated-refresh',
      scopes: [],
    });

    await expect(
      getSnapchatAdsUsableGrant({
        config,
        connection: {
          access_token_ciphertext: 'unreadable-expired-access',
          refresh_token_ciphertext: refreshCiphertext,
          token_expires_at: '2020-01-01T00:00:00Z',
        },
        merchantId: 'merchant',
        credentialSupabase: { rpc } as never,
      })
    ).resolves.toMatchObject({ accessToken: 'recovered-access' });
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'stored-refresh' })
    );
  });

  it('refreshes an unreadable access token while its expiry metadata is still valid', async () => {
    const refreshCiphertext = encryptAdsToken(
      'stored-refresh',
      tokenEncryptionKey,
      'snapchat_ads'
    );
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    refresh.mockResolvedValue({
      accessToken: 'recovered-access',
      expiresIn: 3600,
      refreshToken: 'rotated-refresh',
      scopes: [],
    });

    await expect(
      getSnapchatAdsUsableGrant({
        config,
        connection: {
          access_token_ciphertext: 'unreadable-unexpired-access',
          refresh_token_ciphertext: refreshCiphertext,
          token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
        merchantId: 'merchant',
        credentialSupabase: { rpc } as never,
      })
    ).resolves.toMatchObject({ accessToken: 'recovered-access' });
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'stored-refresh' })
    );
  });

  it('preserves refresh-token decrypt failures for reauthorization marking', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(
      getSnapchatAdsUsableGrant({
        config,
        connection: {
          access_token_ciphertext: 'unreadable-expired-access',
          refresh_token_ciphertext: 'unreadable-refresh',
          token_expires_at: '2020-01-01T00:00:00Z',
        },
        merchantId: 'merchant',
        credentialSupabase: { rpc } as never,
      })
    ).rejects.toMatchObject({
      code: 'SNAPCHAT_ADS_REFRESH_TOKEN_DECRYPT_FAILED',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns refreshed ciphertext and expiry for compare-and-set reauth marking', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    refresh.mockResolvedValue({
      accessToken: 'new-access',
      expiresIn: 3600,
      refreshToken: 'new-refresh',
      scopes: [],
    });

    const result = await getSnapchatAdsUsableGrant({
      config,
      connection: {
        access_token_ciphertext: encryptAdsToken(
          'old-access',
          tokenEncryptionKey,
          'snapchat_ads'
        ),
        refresh_token_ciphertext: encryptAdsToken(
          'old-refresh',
          tokenEncryptionKey,
          'snapchat_ads'
        ),
        token_expires_at: '2020-01-01T00:00:00Z',
      },
      merchantId: 'merchant',
      credentialSupabase: { rpc } as never,
    });

    expect(result).toMatchObject({
      accessToken: 'new-access',
      accessTokenCiphertext: expect.any(String),
      refreshTokenCiphertext: expect.any(String),
      tokenExpiresAt: expect.any(String),
    });
  });

  it('refreshes an access token inside the expiry safety window', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    refresh.mockResolvedValue({
      accessToken: 'refreshed-access',
      expiresIn: 3600,
      refreshToken: 'refreshed-refresh',
      scopes: [],
    });

    await expect(
      getSnapchatAdsUsableAccessToken({
        config,
        connection: {
          access_token_ciphertext: encryptAdsToken(
            'access',
            tokenEncryptionKey,
            'snapchat_ads'
          ),
          refresh_token_ciphertext: encryptAdsToken(
            'refresh',
            tokenEncryptionKey,
            'snapchat_ads'
          ),
          token_expires_at: new Date(Date.now() + 30_000).toISOString(),
        },
        merchantId: 'merchant',
        credentialSupabase: { rpc } as never,
      })
    ).resolves.toBe('refreshed-access');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('fails closed when token persistence loses a concurrent refresh race', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    refresh.mockResolvedValue({
      accessToken: 'new-access',
      expiresIn: 3600,
      refreshToken: 'new-refresh',
      scopes: [],
    });
    await expect(
      getSnapchatAdsUsableAccessToken({
        config,
        connection: {
          access_token_ciphertext: encryptAdsToken(
            'old-access',
            tokenEncryptionKey,
            'snapchat_ads'
          ),
          refresh_token_ciphertext: encryptAdsToken(
            'old-refresh',
            tokenEncryptionKey,
            'snapchat_ads'
          ),
          token_expires_at: '2020-01-01T00:00:00Z',
        },
        merchantId: 'merchant',
        credentialSupabase: { rpc } as never,
      })
    ).rejects.toMatchObject({
      code: 'SNAPCHAT_ADS_TOKEN_REFRESH_WRITE_FAILED',
    });
  });
});
