import 'server-only';

import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import type {
  GoogleAdsEncryptedConnection,
  GoogleAdsResolvedAccessToken,
} from './access-token';

export type GoogleAdsAccessTokenPersistenceResult =
  | { connection: GoogleAdsEncryptedConnection; status: 'unchanged' }
  | { connection: GoogleAdsEncryptedConnection; status: 'updated' }
  | { status: 'conflict' }
  | { status: 'error' };

export async function persistGoogleAdsAccessToken(input: {
  connection: GoogleAdsEncryptedConnection;
  credentialSupabase: AdsCredentialServiceClient;
  merchantId: string;
  resolvedToken: GoogleAdsResolvedAccessToken;
}): Promise<GoogleAdsAccessTokenPersistenceResult> {
  if (!input.resolvedToken.encryptedAccessToken) {
    return { connection: input.connection, status: 'unchanged' };
  }

  const { data, error } = await input.credentialSupabase.rpc(
    'update_google_ads_connection_token_if_current',
    {
      p_access_token_ciphertext: input.resolvedToken.encryptedAccessToken,
      p_expected_access_token_ciphertext:
        input.connection.access_token_ciphertext,
      p_expected_refresh_token_ciphertext:
        input.connection.refresh_token_ciphertext,
      p_merchant_id: input.merchantId,
      p_token_expires_at: input.resolvedToken.expiresAt,
    }
  );
  if (error) return { status: 'error' };
  if (data !== true) return { status: 'conflict' };

  return {
    connection: {
      ...input.connection,
      access_token_ciphertext: input.resolvedToken.encryptedAccessToken,
      token_expires_at: input.resolvedToken.expiresAt,
    },
    status: 'updated',
  };
}
