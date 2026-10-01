import { describe, expect, it, vi } from 'vitest';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import type {
  GoogleAdsEncryptedConnection,
  GoogleAdsResolvedAccessToken,
} from './access-token';
import { persistGoogleAdsAccessToken } from './persist-access-token';

const connection: GoogleAdsEncryptedConnection = {
  access_token_ciphertext: 'old-access',
  refresh_token_ciphertext: 'refresh',
  token_expires_at: '2026-08-27T08:00:00.000Z',
};

const refreshedToken: GoogleAdsResolvedAccessToken = {
  accessToken: 'new-access-token',
  encryptedAccessToken: 'new-access',
  expiresAt: '2026-08-27T10:00:00.000Z',
};

function createCredentialClient(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  } as unknown as AdsCredentialServiceClient;
}

describe('persistGoogleAdsAccessToken', () => {
  it('does not write when the resolved token is still current', async () => {
    const credentialSupabase = createCredentialClient({
      data: true,
      error: null,
    });

    const result = await persistGoogleAdsAccessToken({
      connection,
      credentialSupabase,
      merchantId: 'merchant-1',
      resolvedToken: { ...refreshedToken, encryptedAccessToken: null },
    });

    expect(result).toEqual({ connection, status: 'unchanged' });
    expect(credentialSupabase.rpc).not.toHaveBeenCalled();
  });

  it('persists a refreshed token with the connection CAS before discovery', async () => {
    const credentialSupabase = createCredentialClient({
      data: true,
      error: null,
    });

    const result = await persistGoogleAdsAccessToken({
      connection,
      credentialSupabase,
      merchantId: 'merchant-1',
      resolvedToken: refreshedToken,
    });

    expect(result).toEqual({
      connection: {
        ...connection,
        access_token_ciphertext: 'new-access',
        token_expires_at: '2026-08-27T10:00:00.000Z',
      },
      status: 'updated',
    });
    expect(credentialSupabase.rpc).toHaveBeenCalledWith(
      'update_google_ads_connection_token_if_current',
      {
        p_access_token_ciphertext: 'new-access',
        p_expected_access_token_ciphertext: 'old-access',
        p_expected_refresh_token_ciphertext: 'refresh',
        p_merchant_id: 'merchant-1',
        p_token_expires_at: '2026-08-27T10:00:00.000Z',
      }
    );
  });

  it('reports an update error or a lost CAS race without returning a connection', async () => {
    const errorResult = await persistGoogleAdsAccessToken({
      connection,
      credentialSupabase: createCredentialClient({
        data: null,
        error: new Error('database unavailable'),
      }),
      merchantId: 'merchant-1',
      resolvedToken: refreshedToken,
    });
    const conflictResult = await persistGoogleAdsAccessToken({
      connection,
      credentialSupabase: createCredentialClient({ data: false, error: null }),
      merchantId: 'merchant-1',
      resolvedToken: refreshedToken,
    });

    expect(errorResult).toEqual({ status: 'error' });
    expect(conflictResult).toEqual({ status: 'conflict' });
  });
});
