import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GoogleAdsConfigError,
  getGoogleAdsOAuthConfig,
  getGoogleAdsReportingConfig,
} from './config';

const ENV_KEYS = [
  'GOOGLE_ADS_API_VERSION',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
  'GOOGLE_ADS_OAUTH_CLIENT_ID',
  'GOOGLE_ADS_OAUTH_CLIENT_SECRET',
  'GOOGLE_ADS_OAUTH_REDIRECT_URI',
  'GOOGLE_ADS_STATE_SECRET',
  'GOOGLE_ADS_TOKEN_ENCRYPTION_KEY',
] as const;

describe('Google Ads server configuration', () => {
  beforeEach(() => {
    process.env.GOOGLE_ADS_OAUTH_CLIENT_ID = 'client';
    process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_ADS_STATE_SECRET = 'a'.repeat(32);
    process.env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'developer-token';
    delete process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI;
    delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('uses the canonical HTTPS callback by default', () => {
    expect(getGoogleAdsOAuthConfig().redirectUri).toBe(
      'https://usebaci.com/api/integrations/ads/google/callback'
    );
  });

  it('rejects a callback URI on another host', () => {
    process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI =
      'https://evil.example/api/integrations/ads/google/callback';
    expect(() => getGoogleAdsOAuthConfig()).toThrow(GoogleAdsConfigError);
  });

  it('requires a high-entropy OAuth state secret', () => {
    process.env.GOOGLE_ADS_STATE_SECRET = 'short';
    expect(() => getGoogleAdsOAuthConfig()).toThrow(GoogleAdsConfigError);
  });

  it('rejects a malformed token encryption key before OAuth starts', () => {
    process.env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY = 'not-a-key';
    expect(() => getGoogleAdsOAuthConfig()).toThrow(
      'Invalid GOOGLE_ADS_TOKEN_ENCRYPTION_KEY'
    );
  });

  it('normalizes a hyphenated login customer ID', () => {
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '123-456-7890';
    expect(getGoogleAdsReportingConfig().loginCustomerId).toBe('1234567890');
  });
});
