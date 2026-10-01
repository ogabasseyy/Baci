import { describe, expect, it, vi } from 'vitest';
import {
  getGoogleAdsReauthReason,
  persistGoogleAdsReauthRequired,
} from './reauth';

describe('Google Ads reauthorization helpers', () => {
  it('recognizes only credential refresh failures that require reconnecting', () => {
    expect(
      getGoogleAdsReauthReason({
        code: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
        status: 400,
      })
    ).toBe('GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED');
    expect(
      getGoogleAdsReauthReason({
        code: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
        status: 503,
      })
    ).toBeNull();
    expect(
      getGoogleAdsReauthReason(new Error('GOOGLE_ADS_REFRESH_TOKEN_MISSING'))
    ).toBe('GOOGLE_ADS_REFRESH_TOKEN_MISSING');
    expect(
      getGoogleAdsReauthReason(
        new Error('GOOGLE_ADS_ACCESS_TOKEN_DECRYPT_FAILED')
      )
    ).toBe('GOOGLE_ADS_ACCESS_TOKEN_DECRYPT_FAILED');
    expect(
      getGoogleAdsReauthReason(
        new Error('GOOGLE_ADS_REFRESH_TOKEN_DECRYPT_FAILED')
      )
    ).toBe('GOOGLE_ADS_REFRESH_TOKEN_DECRYPT_FAILED');
    expect(getGoogleAdsReauthReason(new Error('network failure'))).toBeNull();
  });

  it('marks a connection with a missing refresh token for reauthorization', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      persistGoogleAdsReauthRequired({
        connection: {
          access_token_ciphertext: 'access-ciphertext',
          refresh_token_ciphertext: null,
        },
        merchantId: 'merchant-1',
        reason: 'GOOGLE_ADS_REFRESH_TOKEN_MISSING',
        credentialSupabase: { rpc } as never,
      })
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      {
        p_access_token_ciphertext: 'access-ciphertext',
        p_merchant_id: 'merchant-1',
        p_reason: 'GOOGLE_ADS_REFRESH_TOKEN_MISSING',
        p_refresh_token_ciphertext: null,
      }
    );
  });

  it('reports whether the compare-and-set reauthorization write succeeded', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const input = {
      connection: {
        access_token_ciphertext: 'access-ciphertext',
        refresh_token_ciphertext: 'refresh-ciphertext',
      },
      merchantId: 'merchant-1',
      reason: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
      credentialSupabase: { rpc } as never,
    };

    await expect(persistGoogleAdsReauthRequired(input)).resolves.toBe(true);
    await expect(persistGoogleAdsReauthRequired(input)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      {
        p_access_token_ciphertext: 'access-ciphertext',
        p_merchant_id: 'merchant-1',
        p_reason: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED',
        p_refresh_token_ciphertext: 'refresh-ciphertext',
      }
    );
  });
});
