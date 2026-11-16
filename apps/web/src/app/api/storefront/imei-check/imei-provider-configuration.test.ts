import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getImeiHashSalt,
  imeiProviderConfiguration,
} from './imei-provider-configuration';

afterEach(() => vi.unstubAllEnvs());

describe('imeiProviderConfiguration', () => {
  it('exposes exactly the provider settings prepareImeiProvider reads', () => {
    expect(Object.keys(imeiProviderConfiguration).sort()).toEqual([
      'getImeiDisabledTierKeys',
      'getImeiIdentifierEncryptionKey',
      'getPetrockConfig',
      'getPetrockEnabledTierKeys',
      'getSickwApiKey',
      'isPetrockEnabled',
    ]);
  });

  it('reads the settings from the server environment without @/env', () => {
    vi.stubEnv('SICKW_API_KEY', '  sickw ');
    vi.stubEnv('IMEI_HASH_SALT', ' salt ');
    vi.stubEnv('IMEI_DISABLED_TIERS', 'a, b,a,');
    vi.stubEnv('PETROCK_ENABLED', 'true');
    vi.stubEnv('PETROCK_ENABLED_TIERS', 'x');
    vi.stubEnv('IMEI_IDENTIFIER_ENCRYPTION_KEY', 'k');
    expect(imeiProviderConfiguration.getSickwApiKey()).toBe('sickw');
    expect(getImeiHashSalt()).toBe('salt');
    expect(imeiProviderConfiguration.getImeiDisabledTierKeys()).toEqual([
      'a',
      'b',
    ]);
    expect(imeiProviderConfiguration.isPetrockEnabled()).toBe(true);
    expect(imeiProviderConfiguration.getPetrockEnabledTierKeys()).toEqual([
      'x',
    ]);
    expect(imeiProviderConfiguration.getImeiIdentifierEncryptionKey()).toBe(
      'k'
    );
  });

  it('returns safe defaults when nothing is configured', () => {
    for (const name of [
      'SICKW_API_KEY',
      'IMEI_HASH_SALT',
      'IMEI_DISABLED_TIERS',
      'PETROCK_ENABLED',
      'PETROCK_API_TOKEN',
    ])
      vi.stubEnv(name, '');
    expect(imeiProviderConfiguration.getSickwApiKey()).toBeUndefined();
    expect(getImeiHashSalt()).toBeUndefined();
    expect(imeiProviderConfiguration.getImeiDisabledTierKeys()).toEqual([]);
    expect(imeiProviderConfiguration.isPetrockEnabled()).toBe(false);
    expect(imeiProviderConfiguration.getPetrockConfig()).toBeNull();
  });

  it('normalizes the Petrock base URL like @/env does', () => {
    vi.stubEnv('PETROCK_API_TOKEN', 't');
    vi.stubEnv('PETROCK_API_BASE_URL', 'https://p.example/');
    expect(imeiProviderConfiguration.getPetrockConfig()).toEqual({
      baseUrl: 'https://p.example/api/reseller/v1',
      token: 't',
    });
  });
});
