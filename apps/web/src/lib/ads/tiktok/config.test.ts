import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTikTokAdsConfig } from './config';

describe('TikTok Ads config', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('requires the owner sandbox state-echo gate', () => {
    vi.stubEnv('TIKTOK_ADS_APP_ID', 'app');
    vi.stubEnv('TIKTOK_ADS_APP_SECRET', 'secret');
    vi.stubEnv(
      'TIKTOK_ADS_AUTHORIZATION_URL',
      'https://business-api.tiktok.com/portal/authorize'
    );
    vi.stubEnv('TIKTOK_ADS_STATE_SECRET', 'a'.repeat(32));
    vi.stubEnv('TIKTOK_ADS_TOKEN_ENCRYPTION_KEY', 'key');
    expect(() => getTikTokAdsConfig()).toThrow('state echo');
  });

  it('rejects lookalike authorization hosts', () => {
    vi.stubEnv('TIKTOK_ADS_APP_ID', 'app');
    vi.stubEnv('TIKTOK_ADS_APP_SECRET', 'secret');
    vi.stubEnv(
      'TIKTOK_ADS_AUTHORIZATION_URL',
      'https://login-not-tiktok.com/portal/authorize'
    );
    vi.stubEnv('TIKTOK_ADS_STATE_SECRET', 'a'.repeat(32));
    vi.stubEnv('TIKTOK_ADS_TOKEN_ENCRYPTION_KEY', 'key');
    vi.stubEnv('TIKTOK_ADS_STATE_ECHO_VERIFIED', 'true');

    expect(() => getTikTokAdsConfig()).toThrow(
      'authorization URL must be HTTPS on tiktok.com'
    );
  });

  it('rejects a malformed token encryption key before OAuth starts', () => {
    vi.stubEnv('TIKTOK_ADS_APP_ID', 'app');
    vi.stubEnv('TIKTOK_ADS_APP_SECRET', 'secret');
    vi.stubEnv(
      'TIKTOK_ADS_AUTHORIZATION_URL',
      'https://business-api.tiktok.com/portal/authorize'
    );
    vi.stubEnv('TIKTOK_ADS_STATE_SECRET', 'a'.repeat(32));
    vi.stubEnv('TIKTOK_ADS_STATE_ECHO_VERIFIED', 'true');
    vi.stubEnv('TIKTOK_ADS_TOKEN_ENCRYPTION_KEY', 'not-a-key');

    expect(() => getTikTokAdsConfig()).toThrow(
      'Invalid TIKTOK_ADS_TOKEN_ENCRYPTION_KEY'
    );
  });
});
