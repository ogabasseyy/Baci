import { expect, it, vi } from 'vitest';
import {
  getAvailableImeiTierKeys,
  type ImeiCapabilitiesConfiguration,
} from './imei-capabilities';

vi.mock('server-only', () => ({}));
const configuration: ImeiCapabilitiesConfiguration = {
  getAccessSigningSecret: () => 's'.repeat(32),
  getImeiDisabledTierKeys: () => [],
  getImeiHashSalt: () => 'hash-salt',
  getImeiIdentifierEncryptionKey: () => 'e'.repeat(64),
  getPetrockConfig: () => ({
    baseUrl: 'https://provider.example',
    token: 'private-token',
  }),
  getPetrockEnabledTierKeys: () => ['simLock'],
  getSickwApiKey: () => 'private-sickw-key',
  isPetrockEnabled: () => true,
};
const asyncRequest = {
  clientCapabilities: ['imei-async-v1'],
  device: 'smartphone' as const,
};

it('keeps configured Sickw services available when Petrock is off', () => {
  const keys = getAvailableImeiTierKeys({
    ...asyncRequest,
    configuration: { ...configuration, isPetrockEnabled: () => false },
  });
  expect(keys).toContain('basic');
  expect(keys).toContain('simLock');
  expect(keys).not.toContain('esimCompatibility');
});

it('advertises Petrock only to an allowlisted async client in the explicit device scope', () => {
  const petrockOnly = { ...configuration, getSickwApiKey: () => undefined };
  expect(
    getAvailableImeiTierKeys({ ...asyncRequest, configuration: petrockOnly })
  ).toEqual(['simLock']);
  expect(
    getAvailableImeiTierKeys({
      configuration: petrockOnly,
      device: 'smartphone',
      clientCapabilities: [],
    })
  ).toEqual([]);
  expect(
    getAvailableImeiTierKeys({
      ...asyncRequest,
      device: 'tablet',
      configuration: petrockOnly,
    })
  ).toEqual([]);
  expect(
    getAvailableImeiTierKeys({
      ...asyncRequest,
      configuration: { ...petrockOnly, getPetrockEnabledTierKeys: () => [] },
    })
  ).toEqual([]);
});

it.each([
  { getAccessSigningSecret: () => undefined },
  { getAccessSigningSecret: () => 'short' },
  { getImeiHashSalt: () => undefined },
])('fails closed when the payment/hash configuration is unavailable: %o', (missing) => {
  expect(
    getAvailableImeiTierKeys({
      ...asyncRequest,
      configuration: { ...configuration, ...missing },
    })
  ).toEqual([]);
});

it.each([
  { getPetrockConfig: () => null },
  { getImeiIdentifierEncryptionKey: () => undefined },
])('does not switch a selected Petrock service to Sickw when its configuration is missing: %o', (missing) => {
  const keys = getAvailableImeiTierKeys({
    ...asyncRequest,
    configuration: { ...configuration, ...missing },
  });
  expect(keys).not.toContain('simLock');
  expect(keys).toContain('basic');
});

it('excludes disabled services and never emits credentials or provider identifiers', () => {
  const keys = getAvailableImeiTierKeys({
    ...asyncRequest,
    configuration: {
      ...configuration,
      getImeiDisabledTierKeys: () => ['simLock', 'basic'],
    },
  });
  expect(keys).not.toContain('simLock');
  expect(keys).not.toContain('basic');
  expect(JSON.stringify(keys)).not.toMatch(/private-|provider.example|716/);
});
