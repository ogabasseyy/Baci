import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { buildOxygenStagingExpoConfig } from '../config/oxygen-staging-expo-config';
import { installOxygenStagingBuild } from './oxygen-staging-startup';

const mockConfigure = jest.fn();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { configure: (...args: unknown[]) => mockConfigure(...args) },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: {} },
}));
const mockConstants = Constants as unknown as { expoConfig: object };
jest.mock('expo-application', () => ({
  applicationId: 'com.ogabassey.oxygenstaging',
}));
const env = {
  NODE_ENV: 'development',
  EXPO_PUBLIC_OXYGEN_STAGING: '1',
  EXPO_PUBLIC_OXYGEN_API_ORIGIN: 'http://127.0.0.1:3000',
  EXPO_PUBLIC_OXYGEN_AUTH_ORIGIN: 'https://staging-auth.example.com',
  EXPO_PUBLIC_OXYGEN_AUTH_ISSUER: 'https://staging-auth.example.com/auth/v1',
  EXPO_PUBLIC_OXYGEN_PUBLIC_KEY: `sb_publishable_${'a'.repeat(24)}`,
  EXPO_PUBLIC_OXYGEN_MERCHANT_ID: '11111111-1111-4111-8111-111111111111',
  EXPO_PUBLIC_OXYGEN_MERCHANT_SLUG: 'oxygen-test',
} satisfies NodeJS.ProcessEnv;
const previous = { ...process.env };
const originalFetch = globalThis.fetch;
afterEach(() => {
  mockConfigure.mockClear();
  globalThis.fetch = originalFetch;
  process.env = { ...previous };
  delete (globalThis as { __baciOxygenStagingRuntime?: unknown })
    .__baciOxygenStagingRuntime;
});
test('accepts Expo-added manifest metadata while preserving pinned config', () => {
  expect(__DEV__).toBe(true);
  expect(Application.applicationId).toBe('com.ogabassey.oxygenstaging');
  process.env = { ...env };
  const config = buildOxygenStagingExpoConfig(env);
  if (!config) throw new Error('Missing test config');
  mockConstants.expoConfig = {
    ...config,
    extra: { ...config.extra, router: {} },
  };
  expect(() => installOxygenStagingBuild(config, true)).not.toThrow();
  expect(mockConfigure).toHaveBeenCalledWith(
    expect.objectContaining({
      reachabilityUrl: 'http://127.0.0.1:3000/api/csrf',
      reachabilityMethod: 'GET',
      useNativeReachability: false,
    })
  );
});
test('refuses stale OTA/production manifest before installing transport', () => {
  expect(__DEV__).toBe(true);
  expect(Application.applicationId).toBe('com.ogabassey.oxygenstaging');
  process.env = { ...env };
  const config = buildOxygenStagingExpoConfig(env);
  if (!config) throw new Error('Missing test config');
  mockConstants.expoConfig = { ...config, updates: { enabled: true } };
  expect(() => installOxygenStagingBuild(config, true)).toThrow(
    'fresh isolated'
  );
});
test('accepts identical nested staging pins in a different key order', () => {
  process.env = { ...env };
  const config = buildOxygenStagingExpoConfig(env);
  if (!config) throw new Error('Missing test config');
  const profile = config.extra?.oxygenStaging as Record<string, unknown>;
  mockConstants.expoConfig = {
    ...config,
    extra: {
      ...config.extra,
      oxygenStaging: Object.fromEntries(Object.entries(profile).reverse()),
    },
  };
  expect(() => installOxygenStagingBuild(config, true)).not.toThrow();
});
test('rejects a changed nested staging pin', () => {
  process.env = { ...env };
  const config = buildOxygenStagingExpoConfig(env);
  if (!config) throw new Error('Missing test config');
  mockConstants.expoConfig = {
    ...config,
    extra: {
      ...config.extra,
      oxygenStaging: { ...config.extra?.oxygenStaging, merchantSlug: 'other' },
    },
  };
  expect(() => installOxygenStagingBuild(config, true)).toThrow(
    'fresh isolated'
  );
});
test('rejects unexpected nested staging pins', () => {
  process.env = { ...env };
  const config = buildOxygenStagingExpoConfig(env);
  if (!config) throw new Error('Missing test config');
  mockConstants.expoConfig = {
    ...config,
    extra: {
      ...config.extra,
      oxygenStaging: { ...config.extra?.oxygenStaging, unexpected: true },
    },
  };
  expect(() => installOxygenStagingBuild(config, true)).toThrow(
    'fresh isolated'
  );
});

test('refuses a build whose order-service merchant differs from the staging profile', () => {
  process.env = { ...env };
  const config = buildOxygenStagingExpoConfig(env);
  if (!config) throw new Error('Missing test config');
  mockConstants.expoConfig = {
    ...config,
    extra: { ...config.extra, merchantId: 'unrelated-merchant' },
  };
  expect(() => installOxygenStagingBuild(config, true)).toThrow(
    'fresh isolated'
  );
  expect(mockConfigure).not.toHaveBeenCalled();
});

test('opens the native storage file scoped to the installed staging identity', async () => {
  process.env = { ...env };
  const config = buildOxygenStagingExpoConfig(env);
  if (!config) throw new Error('Missing test config');
  mockConstants.expoConfig = config;
  installOxygenStagingBuild(config, true);

  const { getOxygenStagingProfile } = await import('./oxygen-staging-profile');
  const storagePrefix = getOxygenStagingProfile()?.storagePrefix;
  expect(storagePrefix).toMatch(/^baci-oxygen-staging\.v2\./);

  const createMMKV = jest.fn(() => ({
    getString: jest.fn(() => null),
    remove: jest.fn(),
    set: jest.fn(),
  }));
  process.env.NODE_ENV = 'development';
  try {
    jest.doMock('react-native-mmkv', () => ({ createMMKV }));
    await jest.isolateModulesAsync(async () => {
      const storage = await import('./storage');
      await storage.waitForStorageReady();
    });
    expect(createMMKV).toHaveBeenCalledWith({ id: storagePrefix });
  } finally {
    jest.dontMock('react-native-mmkv');
  }
});

test('fails closed if storage is imported before the staging profile is installed', async () => {
  process.env = { ...env };
  const createMMKV = jest.fn();
  try {
    jest.doMock('react-native-mmkv', () => ({ createMMKV }));
    await jest.isolateModulesAsync(async () => {
      await expect(import('./storage')).rejects.toThrow(
        'Install the Oxygen staging profile before opening storage'
      );
    });
    expect(createMMKV).not.toHaveBeenCalled();
  } finally {
    jest.dontMock('react-native-mmkv');
  }
});
