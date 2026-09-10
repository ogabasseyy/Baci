import { describe, expect, it, jest } from '@jest/globals';
import {
  createNativeModules,
  installAdTrackingRuntimeTestReset,
  mockError,
  mockGetTrackingPermissionStatus,
  mockInfo,
  mockLoadAdTrackingNativeModules,
  mockWarn,
  setMockExpoConfigExtra,
} from './ad-tracking-runtime.test-utils';

installAdTrackingRuntimeTestReset();

describe('ad-tracking runtime initialization', () => {
  it('does not load or initialize ad SDKs before ATT authorization', async () => {
    const nativeBridgeError = new TypeError('undefined is not a function');
    const setAdvertiserTrackingEnabled = jest.fn(() => {
      throw nativeBridgeError;
    });
    const initializeSDK = jest.fn(() => {
      throw nativeBridgeError;
    });
    mockLoadAdTrackingNativeModules.mockResolvedValue(
      createNativeModules({
        FBSettings: {
          initializeSDK,
          setAdvertiserTrackingEnabled,
        },
      })
    );

    const { initAdTracking } = await import('./ad-tracking-runtime');

    await initAdTracking();

    expect(mockLoadAdTrackingNativeModules).not.toHaveBeenCalled();
    expect(setAdvertiserTrackingEnabled).not.toHaveBeenCalled();
    expect(initializeSDK).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalledWith(
      'Initialization error:',
      expect.anything()
    );
    expect(mockInfo).toHaveBeenCalledWith(
      'Initialized. Advertising tracking enabled:',
      false
    );
  });

  it('logs rejected native module promises without failing initialization', async () => {
    const nativeBridgeError = new TypeError('async bridge failure');
    const setAdvertiserTrackingEnabled = jest.fn(() =>
      Promise.reject(nativeBridgeError)
    );
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'granted' });
    mockLoadAdTrackingNativeModules.mockResolvedValue(
      createNativeModules({
        FBSettings: {
          initializeSDK: jest.fn(),
          setAdvertiserTrackingEnabled,
        },
      })
    );

    const { initAdTracking } = await import('./ad-tracking-runtime');

    await initAdTracking();
    await Promise.resolve();

    expect(setAdvertiserTrackingEnabled).toHaveBeenCalledWith(true);
    expect(mockWarn).toHaveBeenCalledWith(
      'Facebook advertiser tracking update failed:',
      nativeBridgeError
    );
    expect(mockError).not.toHaveBeenCalledWith(
      'Initialization error:',
      expect.anything()
    );
  });

  it('returns the ATT permission result when the Facebook tracking update fails', async () => {
    const nativeBridgeError = new TypeError('undefined is not a function');
    const setAdvertiserTrackingEnabled = jest.fn(() => {
      throw nativeBridgeError;
    });
    mockLoadAdTrackingNativeModules.mockResolvedValue(
      createNativeModules({
        FBSettings: {
          initializeSDK: jest.fn(),
          setAdvertiserTrackingEnabled,
        },
      })
    );

    const { initAdTracking, requestTrackingPermission } = await import(
      './ad-tracking-runtime'
    );

    await initAdTracking();
    mockError.mockClear();
    mockWarn.mockClear();
    setAdvertiserTrackingEnabled.mockClear();

    await expect(requestTrackingPermission()).resolves.toBe('granted');

    expect(setAdvertiserTrackingEnabled).toHaveBeenCalledWith(true);
    expect(mockWarn).toHaveBeenCalledWith(
      'Facebook advertiser tracking update failed:',
      nativeBridgeError
    );
    expect(mockError).not.toHaveBeenCalledWith(
      'ATT request error:',
      expect.anything()
    );
  });

  it('does not repeat authorized SDK initialization after ATT grant initializes it', async () => {
    const setAdvertiserTrackingEnabled =
      jest.fn<(enabled: boolean) => boolean>();
    const initializeSDK = jest.fn<() => void>();
    mockLoadAdTrackingNativeModules.mockResolvedValue(
      createNativeModules({
        FBSettings: {
          initializeSDK,
          setAdvertiserTrackingEnabled,
        },
      })
    );

    const { initAdTracking, requestTrackingPermission } = await import(
      './ad-tracking-runtime'
    );

    await expect(requestTrackingPermission()).resolves.toBe('granted');
    await initAdTracking();

    expect(setAdvertiserTrackingEnabled).toHaveBeenCalledTimes(1);
    expect(initializeSDK).toHaveBeenCalledTimes(1);
    expect(mockGetTrackingPermissionStatus).not.toHaveBeenCalled();
  });

  it('allows startup initialization to retry when ATT grant cannot load native modules', async () => {
    const setAdvertiserTrackingEnabled =
      jest.fn<(enabled: boolean) => boolean>();
    const initializeSDK = jest.fn<() => void>();
    mockLoadAdTrackingNativeModules
      .mockResolvedValueOnce(createNativeModules())
      .mockResolvedValueOnce(
        createNativeModules({
          FBSettings: {
            initializeSDK,
            setAdvertiserTrackingEnabled,
          },
        })
      );
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'granted' });

    const { initAdTracking, requestTrackingPermission } = await import(
      './ad-tracking-runtime'
    );

    await expect(requestTrackingPermission()).resolves.toBe('granted');
    await initAdTracking();

    expect(mockLoadAdTrackingNativeModules).toHaveBeenCalledTimes(2);
    expect(setAdvertiserTrackingEnabled).toHaveBeenCalledTimes(1);
    expect(initializeSDK).toHaveBeenCalledTimes(1);
  });

  it('initializes TikTok only when app config marks it configured', async () => {
    const initializeTikTok = jest.fn(() => true);
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'granted' });
    setMockExpoConfigExtra({
      apiUrl: 'https://api.test',
      facebookAppId: 'fb-test',
      facebookClientToken: 'client-test',
      tiktokBusiness: {
        isConfigured: true,
      },
    });
    mockLoadAdTrackingNativeModules.mockResolvedValue(
      createNativeModules({
        FBSettings: {
          initializeSDK: jest.fn(),
          setAdvertiserTrackingEnabled: jest.fn(() => true),
        },
        TikTokBusiness: {
          initialize: initializeTikTok,
        },
      })
    );

    const { initAdTracking } = await import('./ad-tracking-runtime');

    await initAdTracking();

    expect(initializeTikTok).toHaveBeenCalledTimes(1);
  });

  it('keeps ATT authorization when TikTok initialization fails', async () => {
    const nativeBridgeError = new Error('TikTok bridge failed');
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'granted' });
    setMockExpoConfigExtra({
      apiUrl: 'https://api.test',
      tiktokBusiness: { isConfigured: true },
    });
    mockLoadAdTrackingNativeModules.mockResolvedValue(
      createNativeModules({
        TikTokBusiness: {
          initialize: jest.fn(() => Promise.reject(nativeBridgeError)),
        },
      })
    );

    const { initAdTracking, isTrackingEnabled } = await import(
      './ad-tracking-runtime'
    );

    await initAdTracking();

    expect(isTrackingEnabled()).toBe(true);
    expect(mockWarn).toHaveBeenCalledWith(
      'TikTok SDK initialization failed:',
      nativeBridgeError
    );
  });

  it('waits for TikTok SDK readiness before completing initialization', async () => {
    let resolveTikTok: (initialized: boolean) => void = () => {};
    let signalInitializeStarted: () => void = () => {};
    const initializeStarted = new Promise<void>((resolve) => {
      signalInitializeStarted = resolve;
    });
    const initializeTikTok = jest.fn(() => {
      signalInitializeStarted();
      return new Promise<boolean>((resolve) => {
        resolveTikTok = resolve;
      });
    });
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'granted' });
    setMockExpoConfigExtra({
      apiUrl: 'https://api.test',
      tiktokBusiness: { isConfigured: true },
    });
    mockLoadAdTrackingNativeModules.mockResolvedValue(
      createNativeModules({
        TikTokBusiness: { initialize: initializeTikTok },
      })
    );

    const { initAdTracking } = await import('./ad-tracking-runtime');
    let didFinish = false;
    const initialization = initAdTracking().then(() => {
      didFinish = true;
    });

    await initializeStarted;

    expect(initializeTikTok).toHaveBeenCalledTimes(1);
    expect(didFinish).toBe(false);

    resolveTikTok(true);
    await initialization;

    expect(didFinish).toBe(true);
  });

  it('keeps TikTok gated until native becomes ready after a timeout', async () => {
    const isTikTokInitialized = jest.fn(() => false);
    const trackEvent = jest.fn();
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'granted' });
    setMockExpoConfigExtra({
      apiUrl: 'https://api.test',
      tiktokBusiness: { isConfigured: true },
    });
    mockLoadAdTrackingNativeModules.mockResolvedValue(
      createNativeModules({
        TikTokBusiness: {
          initialize: jest.fn(() => Promise.resolve(false)),
          isInitialized: isTikTokInitialized,
          trackEvent,
        },
      })
    );

    const { initAdTracking, trackTikTokEvent } = await import(
      './ad-tracking-runtime'
    );

    await initAdTracking();
    trackTikTokEvent('Purchase', 'event-before-readiness');

    expect(trackEvent).not.toHaveBeenCalled();

    isTikTokInitialized.mockReturnValue(true);
    trackTikTokEvent('Purchase', 'event-after-timeout');

    expect(trackEvent).toHaveBeenCalledWith(
      'Purchase',
      'event-after-timeout',
      []
    );
  });

  it('initializes TikTok via onTikTokReady before Facebook native module load finishes', async () => {
    const initializeTikTok = jest.fn(async () => true);
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'granted' });
    setMockExpoConfigExtra({
      apiUrl: 'https://api.test',
      facebookAppId: 'fb-test',
      facebookClientToken: 'client-test',
      tiktokBusiness: { isConfigured: true },
    });

    mockLoadAdTrackingNativeModules.mockImplementation(async (options) => {
      const modules = createNativeModules({
        FBSettings: {
          initializeSDK: jest.fn(),
          setAdvertiserTrackingEnabled:
            jest.fn<(enabled: boolean) => boolean>(),
        },
        TikTokBusiness: { initialize: initializeTikTok },
      });
      await options?.onTikTokReady?.(modules.TikTokBusiness);
      expect(initializeTikTok).toHaveBeenCalledTimes(1);
      return modules;
    });

    const { initAdTracking } = await import('./ad-tracking-runtime');
    await initAdTracking();

    expect(initializeTikTok).toHaveBeenCalledTimes(1);
  });
});
