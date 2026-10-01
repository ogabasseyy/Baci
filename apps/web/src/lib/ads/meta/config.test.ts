import { afterEach, describe, expect, it } from 'vitest';
import { getMetaAdsConfig, MetaAdsConfigError } from './config';

const names = [
  'META_ADS_APP_ID',
  'META_ADS_APP_SECRET',
  'META_ADS_STATE_SECRET',
  'META_ADS_TOKEN_ENCRYPTION_KEY',
] as const;
const original = Object.fromEntries(
  names.map((name) => [name, process.env[name]])
);

afterEach(() => {
  for (const name of names) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('Meta Ads configuration', () => {
  it('uses the pinned canonical production callback and fails closed when missing', () => {
    for (const name of names) delete process.env[name];
    expect(() => getMetaAdsConfig()).toThrow(MetaAdsConfigError);
    Object.assign(process.env, {
      META_ADS_APP_ID: 'app',
      META_ADS_APP_SECRET: 'secret',
      META_ADS_STATE_SECRET: 'a'.repeat(32),
      META_ADS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64url'),
    });
    expect(getMetaAdsConfig().redirectUri).toBe(
      'https://usebaci.com/api/integrations/ads/meta/callback'
    );
  });

  it('rejects a malformed token encryption key before OAuth starts', () => {
    Object.assign(process.env, {
      META_ADS_APP_ID: 'app',
      META_ADS_APP_SECRET: 'secret',
      META_ADS_STATE_SECRET: 'a'.repeat(32),
      META_ADS_TOKEN_ENCRYPTION_KEY: 'not-a-key',
    });
    expect(() => getMetaAdsConfig()).toThrow(
      'Invalid META_ADS_TOKEN_ENCRYPTION_KEY'
    );
  });
});
