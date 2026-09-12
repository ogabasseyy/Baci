import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockFacebookImport = jest.fn();
const mockInitializeSDK = jest.fn(async () => true);
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
      initializeSDK: () => mockInitializeSDK(),
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
    mockInitializeSDK.mockReset();
    mockInitializeSDK.mockImplementation(async () => true);
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
    expect(modules.TikTokBusiness?.trackEvent).toBe(mockTikTokTrackEvent);
  });

  describe('bugfix: TikTok coupled to Facebook initializeSDK', () => {
    it('still assigns TikTokBusiness when Facebook initializeSDK rejects', async () => {
      mockExtra.facebookAppId = 'test-app-id';
      mockExtra.facebookClientToken = 'test-client-token';
      mockInitializeSDK.mockImplementation(async () => {
        throw new Error('initializeSDK stalled');
      });

      const { loadAdTrackingNativeModules } = await import(
        './ad-tracking-native-modules'
      );
      const modules = await loadAdTrackingNativeModules();

      expect(modules.FBSettings).toBeNull();
      expect(modules.TikTokBusiness?.trackEvent).toBe(mockTikTokTrackEvent);
    });

    it('fires onTikTokReady before a hung Facebook initializeSDK resolves', async () => {
      mockExtra.facebookAppId = 'test-app-id';
      mockExtra.facebookClientToken = 'test-client-token';
      let resolveInitialize: ((value: boolean) => void) | undefined;
      let notifyInitializeStarted: (() => void) | undefined;
      const initializeStarted = new Promise<void>((resolve) => {
        notifyInitializeStarted = resolve;
      });
      mockInitializeSDK.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveInitialize = resolve;
            notifyInitializeStarted?.();
          })
      );

      const { loadAdTrackingNativeModules } = await import(
        './ad-tracking-native-modules'
      );
      const onTikTokReady =
        jest.fn<
          (
            tikTok:
              | import('./ad-tracking-native-modules').TikTokBusinessLike
              | null
          ) => void
        >();
      const loading = loadAdTrackingNativeModules({ onTikTokReady });

      await initializeStarted;
      expect(onTikTokReady).toHaveBeenCalledWith(
        expect.objectContaining({ trackEvent: mockTikTokTrackEvent })
      );

      resolveInitialize?.(true);
      const modules = await loading;
      expect(modules.FBSettings).not.toBeNull();
      expect(modules.TikTokBusiness?.trackEvent).toBe(mockTikTokTrackEvent);
    });

    it('still loads Facebook when onTikTokReady stalls', async () => {
      mockExtra.facebookAppId = 'test-app-id';
      mockExtra.facebookClientToken = 'test-client-token';
      let resolveTikTokReady: (() => void) | undefined;
      let notifyTikTokReadyStarted: (() => void) | undefined;
      const tikTokReadyStarted = new Promise<void>((resolve) => {
        notifyTikTokReadyStarted = resolve;
      });
      let notifyFacebookReady: (() => void) | undefined;
      const facebookReady = new Promise<void>((resolve) => {
        notifyFacebookReady = resolve;
      });
      const onTikTokReady = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveTikTokReady = resolve;
            notifyTikTokReadyStarted?.();
          })
      );
      const onFacebookReadyMock = jest.fn();
      let facebookEventLogged = false;

      const { loadAdTrackingNativeModules } = await import(
        './ad-tracking-native-modules'
      );
      const loading = loadAdTrackingNativeModules({
        onTikTokReady,
        onFacebookReady: (facebook) => {
          onFacebookReadyMock(facebook);
          facebook.AppEventsLogger?.logEvent?.('ViewContent');
          facebookEventLogged = true;
          notifyFacebookReady?.();
        },
      });

      await tikTokReadyStarted;
      await facebookReady;

      expect(onFacebookReadyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          FBSettings: expect.anything(),
          AppEventsLogger: expect.anything(),
        })
      );
      expect(facebookEventLogged).toBe(true);
      expect(mockInitializeSDK).toHaveBeenCalled();

      resolveTikTokReady?.();
      const modules = await loading;
      expect(modules.FBSettings).not.toBeNull();
      expect(modules.TikTokBusiness?.trackEvent).toBe(mockTikTokTrackEvent);
    });

    it('resolves with TikTokBusiness null when @baci/tiktok-business import rejects', async () => {
      jest.doMock('@baci/tiktok-business', () => {
        throw new Error('TikTok native module missing');
      });

      const { loadAdTrackingNativeModules } = await import(
        './ad-tracking-native-modules'
      );
      const onTikTokReady =
        jest.fn<
          (
            tikTok:
              | import('./ad-tracking-native-modules').TikTokBusinessLike
              | null
          ) => void
        >();
      const modules = await loadAdTrackingNativeModules({ onTikTokReady });

      expect(modules.TikTokBusiness).toBeNull();
      expect(onTikTokReady).toHaveBeenCalledWith(null);
    });
  });
});
