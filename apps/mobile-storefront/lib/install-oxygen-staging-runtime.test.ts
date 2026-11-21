import { installOxygenStagingRuntime } from './install-oxygen-staging-runtime';
import { readOxygenStagingProfile } from './oxygen-staging-profile';

const input = {
  apiOrigin: 'http://127.0.0.1:3000',
  authOrigin: 'https://staging-auth.example.com',
  expectedAuthIssuer: 'https://staging-auth.example.com/auth/v1',
  publicKey: `sb_publishable_${'a'.repeat(24)}`,
  merchantId: '11111111-1111-4111-8111-111111111111',
  merchantSlug: 'oxygen-test',
};
test('installs transport once before consumers, forbids hot profile changes', () => {
  const runtime = { fetch: jest.fn() as typeof fetch };
  const profile = readOxygenStagingProfile(input, true);
  installOxygenStagingRuntime(profile, runtime);
  const installed = runtime.fetch;
  installOxygenStagingRuntime(profile, runtime);
  expect(runtime.fetch).toBe(installed);
  expect(() =>
    installOxygenStagingRuntime(
      readOxygenStagingProfile({ ...input, merchantSlug: 'other' }, true),
      runtime
    )
  ).toThrow('reload');
});

test('order API resolution and checkout storage use the installed profile before module initialization', () => {
  const originalFetch = globalThis.fetch;
  const runtime = globalThis as typeof globalThis & {
    __baciOxygenStagingRuntime?: unknown;
  };
  try {
    const profile = readOxygenStagingProfile(input, true);
    installOxygenStagingRuntime(profile);
    const { resolveApiBaseUrl } = require('./api-url');
    const { oxygenStagingStorageKey } = require('./oxygen-staging-profile');
    expect(resolveApiBaseUrl()).toBe(profile.apiOrigin);
    expect(resolveApiBaseUrl(profile.apiOrigin)).toBe(profile.apiOrigin);
    expect(() => resolveApiBaseUrl('https://usebaci.com')).toThrow();
    const key = oxygenStagingStorageKey('checkout-generation-v1');
    expect(key).toBe(`${profile.storagePrefix}checkout-generation-v1`);
    expect(oxygenStagingStorageKey(key)).toBe(key);
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  } finally {
    runtime.fetch = originalFetch;
    delete runtime.__baciOxygenStagingRuntime;
  }
});
