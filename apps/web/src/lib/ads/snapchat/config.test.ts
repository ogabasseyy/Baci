import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSnapchatAdsConfig } from './config';

describe('Snapchat Ads config', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fails closed when server-only OAuth configuration is absent', () => {
    expect(() => getSnapchatAdsConfig()).toThrow('SNAPCHAT_ADS');
  });

  it('rejects a malformed token encryption key before OAuth starts', () => {
    vi.stubEnv('SNAPCHAT_ADS_CLIENT_ID', 'client');
    vi.stubEnv('SNAPCHAT_ADS_CLIENT_SECRET', 'secret');
    vi.stubEnv('SNAPCHAT_ADS_STATE_SECRET', 'a'.repeat(32));
    vi.stubEnv('SNAPCHAT_ADS_TOKEN_ENCRYPTION_KEY', 'not-a-key');

    expect(() => getSnapchatAdsConfig()).toThrow(
      'Invalid SNAPCHAT_ADS_TOKEN_ENCRYPTION_KEY'
    );
  });
});
