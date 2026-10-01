import 'server-only';

import { decryptAdsToken } from '@/lib/ads/crypto';
import type { TikTokAdsConfig } from './config';
import { TIKTOK_ADS_PROVIDER } from './constants';

export interface TikTokAdsEncryptedConnection {
  access_token_ciphertext: string | null;
}

export function resolveTikTokAdsAccessToken(
  connection: TikTokAdsEncryptedConnection,
  config: TikTokAdsConfig
): string {
  if (!connection.access_token_ciphertext)
    throw new Error('TIKTOK_ADS_REAUTH_REQUIRED');
  try {
    return decryptAdsToken(
      connection.access_token_ciphertext,
      config.tokenEncryptionKey,
      TIKTOK_ADS_PROVIDER
    );
  } catch {
    throw new Error('TIKTOK_ADS_ACCESS_TOKEN_DECRYPT_FAILED');
  }
}
