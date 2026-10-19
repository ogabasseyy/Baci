import 'server-only';

import { getCanonicalAdsCallbackUri } from '@/lib/ads/config';
import { isValidAdsTokenEncryptionKey } from '@/lib/ads/token-encryption-key';
import { META_ADS_PROVIDER } from './constants';

export const META_ADS_CONFIG_MISSING = 'Meta Ads integration is not configured';

export interface MetaAdsConfig {
  appId: string;
  appSecret: string;
  oauthStateSecret: string;
  redirectUri: string;
  tokenEncryptionKey: string;
}

export class MetaAdsConfigError extends Error {
  readonly code = 'META_ADS_CONFIG_MISSING';

  constructor(message: string) {
    super(message);
    this.name = 'MetaAdsConfigError';
  }
}

function readRequired(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new MetaAdsConfigError(`Missing ${name}`);
  }
  return value;
}

function readTokenEncryptionKey(): string {
  const value = readRequired('META_ADS_TOKEN_ENCRYPTION_KEY');
  if (!isValidAdsTokenEncryptionKey(value)) {
    throw new MetaAdsConfigError(
      'Invalid META_ADS_TOKEN_ENCRYPTION_KEY: expected 32-byte hex or base64url'
    );
  }
  return value;
}

export function getMetaAdsConfig(): MetaAdsConfig {
  return {
    appId: readRequired('META_ADS_APP_ID'),
    appSecret: readRequired('META_ADS_APP_SECRET'),
    oauthStateSecret: readRequired('META_ADS_STATE_SECRET', 32),
    redirectUri: getCanonicalAdsCallbackUri(META_ADS_PROVIDER),
    tokenEncryptionKey: readTokenEncryptionKey(),
  };
}
