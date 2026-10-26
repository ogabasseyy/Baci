import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const originalHostedMode = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
let mockLocalPrefix = '';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('./local-storefront-storage-prefix', () => ({
  getLocalStorefrontStoragePrefix: () => mockLocalPrefix,
}));

describe('bugfix: sandbox tracking must not require a native usage description', () => {
  beforeEach(() => {
    jest.resetModules();
    mockLocalPrefix = '';
    delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
  });

  afterEach(() => {
    if (originalHostedMode === undefined) {
      delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    } else {
      process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = originalHostedMode;
    }
  });

  it.each([
    '1',
    'invalid',
    'local',
  ])('%s excludes native tracking without granting permission', async (mode) => {
    if (mode === 'local') mockLocalPrefix = 'baci-local-test.';
    else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = mode;
    const nativeModuleLoaded = jest.fn();
    jest.doMock('expo-tracking-transparency', () => {
      nativeModuleLoaded();
      throw new Error("This app is missing 'NSUserTrackingUsageDescription'");
    });

    const tracking = await import('./tracking-transparency');

    expect(tracking.canRequestTrackingTransparency()).toBe(false);
    await expect(tracking.getTrackingPermissionStatus()).resolves.toEqual({
      status: 'denied',
    });
    await expect(tracking.requestTrackingPermissionStatus()).resolves.toEqual({
      status: 'denied',
    });
    expect(nativeModuleLoaded).not.toHaveBeenCalled();
  });
});
