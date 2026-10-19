import 'server-only';

import { decryptAdsToken } from '@/lib/ads/crypto';
import type { MetaAdsConfig } from './config';
import { META_ADS_PROVIDER } from './constants';

export interface MetaAdsEncryptedConnection {
  access_token_ciphertext: string | null;
  token_expires_at: string | null;
}

function tokenStillValid(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  const expiresAt = Date.parse(tokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000;
}

export function resolveMetaAdsAccessToken(
  connection: MetaAdsEncryptedConnection,
  config: MetaAdsConfig
): string {
  if (
    !connection.access_token_ciphertext ||
    !tokenStillValid(connection.token_expires_at)
  ) {
    throw new Error('META_ADS_REAUTH_REQUIRED');
  }
  try {
    return decryptAdsToken(
      connection.access_token_ciphertext,
      config.tokenEncryptionKey,
      META_ADS_PROVIDER
    );
  } catch {
    throw new Error('META_ADS_ACCESS_TOKEN_DECRYPT_FAILED');
  }
}
