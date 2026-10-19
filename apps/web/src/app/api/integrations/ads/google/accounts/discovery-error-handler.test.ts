import { describe, expect, it, vi } from 'vitest';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { GoogleAdsProviderError } from '@/lib/google-ads/provider';
import { handleGoogleAdsAccountDiscoveryError } from './discovery-error-handler';

const connection = {
  access_token_ciphertext: 'access-ciphertext',
  refresh_token_ciphertext: 'refresh-ciphertext',
};

describe('handleGoogleAdsAccountDiscoveryError', () => {
  it('persists revoked access before returning the discovery failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    const response = await handleGoogleAdsAccountDiscoveryError({
      connection,
      credentialSupabase: {
        rpc,
      } as unknown as AdsCredentialServiceClient,
      error: new GoogleAdsProviderError('GOOGLE_ADS_ACCESS_REVOKED', 401),
      merchantId: 'merchant-1',
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to discover Google Ads accounts',
    });
    expect(rpc).toHaveBeenCalledWith(
      'mark_google_ads_connection_reauth_if_current',
      {
        p_access_token_ciphertext: 'access-ciphertext',
        p_merchant_id: 'merchant-1',
        p_reason: 'GOOGLE_ADS_ACCESS_REVOKED',
        p_refresh_token_ciphertext: 'refresh-ciphertext',
      }
    );
  });

  it('returns a status-write failure when the current grant changed', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });

    const response = await handleGoogleAdsAccountDiscoveryError({
      connection,
      credentialSupabase: {
        rpc,
      } as unknown as AdsCredentialServiceClient,
      error: new GoogleAdsProviderError('GOOGLE_ADS_ACCESS_REVOKED', 401),
      merchantId: 'merchant-1',
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to update Google Ads authorization status',
    });
  });

  it('preserves bounded discovery retry responses for non-revocation errors', async () => {
    const rpc = vi.fn();

    const response = await handleGoogleAdsAccountDiscoveryError({
      connection,
      credentialSupabase: {
        rpc,
      } as unknown as AdsCredentialServiceClient,
      error: new GoogleAdsProviderError('GOOGLE_ADS_MANAGER_DEPTH_LIMIT'),
      merchantId: 'merchant-1',
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'GOOGLE_ADS_MANAGER_DEPTH_LIMIT',
      retry: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
