import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getImeiDisabledTierKeys: () => ['tier-a'],
  getImeiIdentifierEncryptionKey: () => 'key',
  getPetrockConfig: () => null,
  getPetrockEnabledTierKeys: () => [],
  getSickwApiKey: () => 'sickw',
  isPetrockEnabled: () => false,
}));

import { imeiProviderConfiguration } from './imei-provider-configuration';

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

  it('reads through to the environment accessors', () => {
    expect(imeiProviderConfiguration.getSickwApiKey()).toBe('sickw');
    expect(imeiProviderConfiguration.getImeiDisabledTierKeys()).toEqual([
      'tier-a',
    ]);
    expect(imeiProviderConfiguration.isPetrockEnabled()).toBe(false);
  });
});
