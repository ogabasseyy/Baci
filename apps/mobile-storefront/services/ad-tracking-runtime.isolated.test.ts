import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

let mockPlatformOS: 'ios' | 'android' | 'web' = 'android';
const originalEnvironment = { ...process.env };
const mockGetTrackingPermissionStatus = jest.fn(async () => ({
  status: 'granted' as const,
}));
const mockRequestTrackingPermissionStatus = jest.fn(async () => ({
  status: 'granted' as const,
}));
const mockLoadAdTrackingNativeModules = jest.fn(async () => ({
  AEMReporterIOS: null,
  AppEventsLogger: null,
  FBSettings: null,
  TikTokBusiness: null,
}));

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(),
  randomUUID: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('@/lib/tracking-transparency', () => ({
  getTrackingPermissionStatus: mockGetTrackingPermissionStatus,
  requestTrackingPermissionStatus: mockRequestTrackingPermissionStatus,
}));

jest.mock('./ad-tracking-native-modules', () => ({
  loadAdTrackingNativeModules: mockLoadAdTrackingNativeModules,
}));

describe('isolated storefront ad-tracking runtime', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPlatformOS = 'android';
    delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    delete process.env.EXPO_PUBLIC_LOCAL_STOREFRONT;
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('keeps tracking disabled and initialization settled on isolated Android', async () => {
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    const runtime = await import('./ad-tracking-runtime');
    const state = await import('./ad-tracking-state');

    await runtime.initAdTracking();

    expect(state.getIsTrackingAllowed()).toBe(false);
    expect(state.getIsInitialized()).toBe(true);
    await expect(runtime.requestTrackingPermission()).resolves.toBe('denied');
    expect(state.getIsTrackingAllowed()).toBe(false);
    expect(state.getIsInitialized()).toBe(true);
    expect(mockGetTrackingPermissionStatus).not.toHaveBeenCalled();
    expect(mockRequestTrackingPermissionStatus).not.toHaveBeenCalled();
    expect(mockLoadAdTrackingNativeModules).not.toHaveBeenCalled();
  });

  it.each([
    'hosted',
    'local',
  ])('keeps tracking disabled in isolated iOS %s mode', async (mode) => {
    mockPlatformOS = 'ios';
    if (mode === 'hosted') {
      process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    } else {
      process.env.EXPO_PUBLIC_LOCAL_STOREFRONT = '1';
      process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.2:3100';
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://192.168.1.2:54321';
    }
    const runtime = await import('./ad-tracking-runtime');
    const state = await import('./ad-tracking-state');

    await runtime.initAdTracking();

    expect(state.getIsTrackingAllowed()).toBe(false);
    expect(state.getIsInitialized()).toBe(true);
    await expect(runtime.requestTrackingPermission()).resolves.toBe('denied');
    expect(state.getIsTrackingAllowed()).toBe(false);
    expect(state.getIsInitialized()).toBe(true);
    expect(mockGetTrackingPermissionStatus).not.toHaveBeenCalled();
    expect(mockRequestTrackingPermissionStatus).not.toHaveBeenCalled();
    expect(mockLoadAdTrackingNativeModules).not.toHaveBeenCalled();
  });
});
