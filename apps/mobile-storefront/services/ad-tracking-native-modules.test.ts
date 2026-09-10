import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockFacebookImport = jest.fn();
const mockTikTokTrackEvent = jest.fn();
const mockExtra: Record<string, unknown> = {};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: mockExtra } },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('react-native-fbsdk-next', () => {
  throw new Error('Login token module requires initialized SDK');
});
jest.mock('react-native-fbsdk-next/src/FBSettings', () => {
  mockFacebookImport();
  if (!mockExtra.facebookAppId || !mockExtra.facebookClientToken) {
    throw new Error('Facebook SDK has not been initialized');
  }
  return {
    __esModule: true,
    default: {
      setAppID: jest.fn(),
      setClientToken: jest.fn(),
      // Patched native bridge resolves after fullyInitialize on Android too.
      initializeSDK: jest.fn(async () => true),
    },
  };
});
jest.mock('react-native-fbsdk-next/src/FBAppEventsLogger', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('react-native-fbsdk-next/src/FBAEMReporter', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('@baci/tiktok-business', () => ({
  __esModule: true,
  default: { trackEvent: mockTikTokTrackEvent },
}));

describe('loadAdTrackingNativeModules', () => {
  beforeEach(() => {
    jest.resetModules();
    mockFacebookImport.mockClear();
    delete mockExtra.facebookAppId;
    delete mockExtra.facebookClientToken;
  });

  it('does not import an unconfigured Facebook SDK on Android', async () => {
    const { loadAdTrackingNativeModules } = await import(
      './ad-tracking-native-modules'
    );

    const modules = await loadAdTrackingNativeModules();

    expect(mockFacebookImport).not.toHaveBeenCalled();
    expect(modules.FBSettings).toBeNull();
    expect(modules.TikTokBusiness?.trackEvent).toBe(mockTikTokTrackEvent);
  });

  it('loads tracking without evaluating the uninitialized login module when configured', async () => {
    mockExtra.facebookAppId = 'test-app-id';
    mockExtra.facebookClientToken = 'test-client-token';
    const { loadAdTrackingNativeModules } = await import(
      './ad-tracking-native-modules'
    );

    const modules = await loadAdTrackingNativeModules();

    expect(mockFacebookImport).toHaveBeenCalledTimes(1);
    expect(modules.FBSettings).not.toBeNull();
    expect(modules.AppEventsLogger).not.toBeNull();
    expect(modules.AEMReporterIOS).not.toBeNull();
  });
});
