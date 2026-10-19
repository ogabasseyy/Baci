import { describe, expect, it, vi } from 'vitest';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { tokenResolutionErrorResponse } from './token-resolution-error-response';

describe('Google Ads token-resolution error responses', () => {
  it('persists reauthorization before reporting an expired token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const response = await tokenResolutionErrorResponse({
      connection: {
        access_token_ciphertext: 'access-ciphertext',
        refresh_token_ciphertext: 'refresh-ciphertext',
      },
      credentialSupabase: { rpc } as unknown as AdsCredentialServiceClient,
      error: { code: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED', status: 400 },
      merchantId: 'merchant-1',
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Google Ads authorization expired',
    });
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

  it('reports status-write failures without claiming the token was handled', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const response = await tokenResolutionErrorResponse({
      connection: {
        access_token_ciphertext: 'access-ciphertext',
        refresh_token_ciphertext: 'refresh-ciphertext',
      },
      credentialSupabase: { rpc } as unknown as AdsCredentialServiceClient,
      error: { code: 'GOOGLE_ADS_ACCESS_TOKEN_REFRESH_FAILED', status: 400 },
      merchantId: 'merchant-1',
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to update Google Ads authorization status',
    });
  });
});
