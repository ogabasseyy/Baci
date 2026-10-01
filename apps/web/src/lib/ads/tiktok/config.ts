import 'server-only';

import { getCanonicalAdsCallbackUri } from '@/lib/ads/config';
import { isValidAdsTokenEncryptionKey } from '@/lib/ads/token-encryption-key';
import { TIKTOK_ADS_PROVIDER } from './constants';

export const TIKTOK_ADS_CONFIG_MISSING =
  'TikTok Ads integration is not configured';

export interface TikTokAdsConfig {
  appId: string;
  appSecret: string;
  authorizationUrl: string;
  oauthStateSecret: string;
  redirectUri: string;
  tokenEncryptionKey: string;
}

export class TikTokAdsConfigError extends Error {
  readonly code = 'TIKTOK_ADS_CONFIG_MISSING';
  constructor(message: string) {
    super(message);
    this.name = 'TikTokAdsConfigError';
  }
}

function required(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength)
    throw new TikTokAdsConfigError(`Missing ${name}`);
  return value;
}

function tokenEncryptionKey(): string {
  const value = required('TIKTOK_ADS_TOKEN_ENCRYPTION_KEY');
  if (!isValidAdsTokenEncryptionKey(value)) {
    throw new TikTokAdsConfigError(
      'Invalid TIKTOK_ADS_TOKEN_ENCRYPTION_KEY: expected 32-byte hex or base64url'
    );
  }
  return value;
}

function approvedAuthorizationUrl(): string {
  const value = required('TIKTOK_ADS_AUTHORIZATION_URL');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TikTokAdsConfigError('Invalid TIKTOK_ADS_AUTHORIZATION_URL');
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    (hostname !== 'tiktok.com' && !hostname.endsWith('.tiktok.com'))
  ) {
    throw new TikTokAdsConfigError(
      'TikTok authorization URL must be HTTPS on tiktok.com'
    );
  }
  // TikTok must confirm in the sandbox that arbitrary state is echoed before
  // this connector can be enabled. Cookie-only correlation is not sufficient.
  if (process.env.TIKTOK_ADS_STATE_ECHO_VERIFIED !== 'true') {
    throw new TikTokAdsConfigError(
      'TikTok OAuth state echo has not been sandbox-verified'
    );
  }
  return url.toString();
}

export function getTikTokAdsConfig(): TikTokAdsConfig {
  return {
    appId: required('TIKTOK_ADS_APP_ID'),
    appSecret: required('TIKTOK_ADS_APP_SECRET'),
    authorizationUrl: approvedAuthorizationUrl(),
    oauthStateSecret: required('TIKTOK_ADS_STATE_SECRET', 32),
    redirectUri: getCanonicalAdsCallbackUri(TIKTOK_ADS_PROVIDER),
    tokenEncryptionKey: tokenEncryptionKey(),
  };
}
