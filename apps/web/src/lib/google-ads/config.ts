import 'server-only';

import { isValidAdsTokenEncryptionKey } from '@/lib/ads/token-encryption-key';

export const GOOGLE_ADS_PROVIDER = 'google_ads' as const;
export const GOOGLE_ADS_SCOPE =
  'https://www.googleapis.com/auth/adwords' as const;
export const GOOGLE_ADS_CONFIG_MISSING =
  'Google Ads integration is not configured';
export const GOOGLE_ADS_CALLBACK_PATH =
  '/api/integrations/ads/google/callback' as const;
export const GOOGLE_ADS_DEFAULT_REDIRECT_URI = `https://usebaci.com${GOOGLE_ADS_CALLBACK_PATH}`;

export interface GoogleAdsOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  oauthStateSecret: string;
  tokenEncryptionKey: string;
}

export interface GoogleAdsReportingConfig {
  developerToken: string;
  loginCustomerId?: string;
}

export class GoogleAdsConfigError extends Error {
  readonly code = 'GOOGLE_ADS_CONFIG_MISSING';

  constructor(message: string) {
    super(message);
    this.name = 'GoogleAdsConfigError';
  }
}

function readRequired(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new GoogleAdsConfigError(`Missing ${name}`);
  }
  return value;
}

function readRedirectUri(): string {
  const configured = process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI?.trim();
  const value = configured || GOOGLE_ADS_DEFAULT_REDIRECT_URI;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'usebaci.com' ||
      parsed.port !== '' ||
      parsed.pathname !== GOOGLE_ADS_CALLBACK_PATH ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new Error('invalid callback path');
    }
  } catch {
    throw new GoogleAdsConfigError(
      'GOOGLE_ADS_OAUTH_REDIRECT_URI must be an HTTPS callback on the Baci Google Ads route'
    );
  }
  return value;
}

function readTokenEncryptionKey(): string {
  const value = readRequired('GOOGLE_ADS_TOKEN_ENCRYPTION_KEY');
  if (!isValidAdsTokenEncryptionKey(value)) {
    throw new GoogleAdsConfigError(
      'Invalid GOOGLE_ADS_TOKEN_ENCRYPTION_KEY: expected 32-byte hex or base64url'
    );
  }
  return value;
}

export function getGoogleAdsOAuthConfig(): GoogleAdsOAuthConfig {
  return {
    clientId: readRequired('GOOGLE_ADS_OAUTH_CLIENT_ID'),
    clientSecret: readRequired('GOOGLE_ADS_OAUTH_CLIENT_SECRET'),
    oauthStateSecret: readRequired('GOOGLE_ADS_STATE_SECRET', 32),
    redirectUri: readRedirectUri(),
    tokenEncryptionKey: readTokenEncryptionKey(),
  };
}

export function getGoogleAdsReportingConfig(): GoogleAdsReportingConfig {
  const developerToken = readRequired('GOOGLE_ADS_DEVELOPER_TOKEN');
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim();
  if (
    loginCustomerId &&
    !/^\d{10}$/.test(loginCustomerId.replaceAll('-', ''))
  ) {
    throw new GoogleAdsConfigError(
      'GOOGLE_ADS_LOGIN_CUSTOMER_ID must contain ten digits'
    );
  }
  return {
    developerToken,
    ...(loginCustomerId
      ? { loginCustomerId: loginCustomerId.replaceAll('-', '') }
      : {}),
  };
}
