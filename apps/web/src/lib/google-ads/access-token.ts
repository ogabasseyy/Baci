import 'server-only';

import type { GoogleAdsOAuthConfig } from '@/lib/google-ads/config';
import {
  decryptGoogleAdsSecret,
  encryptGoogleAdsSecret,
} from '@/lib/google-ads/crypto';
import { refreshGoogleAdsAccessToken } from '@/lib/google-ads/provider';

export interface GoogleAdsEncryptedConnection {
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
}

export interface GoogleAdsResolvedAccessToken {
  accessToken: string;
  encryptedAccessToken: string | null;
  expiresAt: string | null;
}

function tokenStillValid(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  const expiresAt = Date.parse(tokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000;
}

export async function resolveGoogleAdsAccessToken(
  connection: GoogleAdsEncryptedConnection,
  oauthConfig: GoogleAdsOAuthConfig,
  fetchImpl: typeof fetch = fetch
): Promise<GoogleAdsResolvedAccessToken> {
  if (
    connection.access_token_ciphertext &&
    tokenStillValid(connection.token_expires_at)
  ) {
    try {
      return {
        accessToken: decryptGoogleAdsSecret(
          connection.access_token_ciphertext,
          oauthConfig.tokenEncryptionKey
        ),
        encryptedAccessToken: null,
        expiresAt: connection.token_expires_at,
      };
    } catch {
      throw new Error('GOOGLE_ADS_ACCESS_TOKEN_DECRYPT_FAILED');
    }
  }
  if (!connection.refresh_token_ciphertext) {
    throw new Error('GOOGLE_ADS_REFRESH_TOKEN_MISSING');
  }
  let refreshToken: string;
  try {
    refreshToken = decryptGoogleAdsSecret(
      connection.refresh_token_ciphertext,
      oauthConfig.tokenEncryptionKey
    );
  } catch {
    throw new Error('GOOGLE_ADS_REFRESH_TOKEN_DECRYPT_FAILED');
  }
  const refreshed = await refreshGoogleAdsAccessToken(
    {
      clientId: oauthConfig.clientId,
      clientSecret: oauthConfig.clientSecret,
      refreshToken,
    },
    fetchImpl
  );
  return {
    accessToken: refreshed.accessToken,
    encryptedAccessToken: encryptGoogleAdsSecret(
      refreshed.accessToken,
      oauthConfig.tokenEncryptionKey
    ),
    expiresAt: refreshed.expiresAt,
  };
}
