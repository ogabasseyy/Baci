import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { getOxygenStagingProfile } from './oxygen-staging-profile';

const originalEnvironment = { ...process.env };

jest.mock('./oxygen-staging-profile', () => ({
  getOxygenStagingProfile: jest.fn(() => null),
}));

let mockPlatformOS: 'ios' | 'android' | 'web' = 'ios';

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));

describe('tracking transparency wrapper', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPlatformOS = 'ios';
    delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    delete process.env.EXPO_PUBLIC_LOCAL_STOREFRONT;
    jest.mocked(getOxygenStagingProfile).mockReturnValue(null);
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it.each([
    'EXPO_PUBLIC_HOSTED_STOREFRONT',
    'EXPO_PUBLIC_LOCAL_STOREFRONT',
  ])('does not load or query native tracking in %s', async (mode) => {
    process.env[mode] = '1';
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.2:3100';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://192.168.1.2:54321';
    const loadNativeTracking = jest.fn(() => {
      throw new Error('Missing tracking usage description');
    });
    jest.doMock('expo-tracking-transparency', loadNativeTracking);
    const {
      canRequestTrackingTransparency,
      getTrackingPermissionStatus,
      requestTrackingPermissionStatus,
    } = await import('./tracking-transparency');

    expect(canRequestTrackingTransparency()).toBe(false);
    await expect(getTrackingPermissionStatus()).resolves.toEqual({
      status: 'denied',
    });
    await expect(requestTrackingPermissionStatus()).resolves.toEqual({
      status: 'denied',
    });
    expect(loadNativeTracking).not.toHaveBeenCalled();
  });

  it('never requests tracking in isolated Oxygen staging on iOS', async () => {
    const staging = await import('./oxygen-staging-profile');
    jest.mocked(staging.getOxygenStagingProfile).mockReturnValue({} as never);
    const getTrackingPermissionsAsync = jest.fn();
    jest.doMock('expo-tracking-transparency', () => ({
      getTrackingPermissionsAsync,
    }));
    const { getTrackingPermissionStatus, requestTrackingPermissionStatus } =
      await import('./tracking-transparency');
    await expect(getTrackingPermissionStatus()).resolves.toEqual({
      status: 'denied',
    });
    await expect(requestTrackingPermissionStatus()).resolves.toEqual({
      status: 'denied',
    });
    expect(getTrackingPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns undetermined when the iOS tracking module fails during import', async () => {
    jest.doMock('expo-tracking-transparency', () => {
      throw new TypeError('undefined is not a function');
    });

    const { getTrackingPermissionStatus } = await import(
      './tracking-transparency'
    );

    await expect(getTrackingPermissionStatus()).resolves.toEqual({
      status: 'undetermined',
    });
  });

  it('returns denied when requesting tracking permission is unavailable', async () => {
    jest.doMock('expo-tracking-transparency', () => ({
      getTrackingPermissionsAsync: jest.fn(),
    }));

    const { requestTrackingPermissionStatus } = await import(
      './tracking-transparency'
    );

    await expect(requestTrackingPermissionStatus()).resolves.toEqual({
      status: 'denied',
    });
  });

  it('uses the native tracking transparency methods when available', async () => {
    const getTrackingPermissionsAsync = jest
      .fn<() => Promise<{ status: string }>>()
      .mockResolvedValue({ status: 'granted' });
    const requestTrackingPermissionsAsync = jest
      .fn<() => Promise<{ status: string }>>()
      .mockResolvedValue({ status: 'denied' });
    jest.doMock('expo-tracking-transparency', () => ({
      getTrackingPermissionsAsync,
      requestTrackingPermissionsAsync,
    }));

    const { getTrackingPermissionStatus, requestTrackingPermissionStatus } =
      await import('./tracking-transparency');

    await expect(getTrackingPermissionStatus()).resolves.toEqual({
      status: 'granted',
    });
    await expect(requestTrackingPermissionStatus()).resolves.toEqual({
      status: 'denied',
    });
  });

  it('does not import the iOS tracking module on Android', async () => {
    mockPlatformOS = 'android';
    const getTrackingPermissionsAsync = jest.fn();
    jest.doMock('expo-tracking-transparency', () => ({
      getTrackingPermissionsAsync,
    }));

    const { getTrackingPermissionStatus, requestTrackingPermissionStatus } =
      await import('./tracking-transparency');

    await expect(getTrackingPermissionStatus()).resolves.toEqual({
      status: 'granted',
    });
    await expect(requestTrackingPermissionStatus()).resolves.toEqual({
      status: 'granted',
    });
    expect(getTrackingPermissionsAsync).not.toHaveBeenCalled();
  });
});
