import { describe, expect, it, jest } from '@jest/globals';
import {
  createNativeModules,
  installAdTrackingRuntimeTestReset,
  mockGetTrackingPermissionStatus,
  mockLoadAdTrackingNativeModules,
  setMockExpoConfigExtra,
} from './ad-tracking-runtime.test-utils';

installAdTrackingRuntimeTestReset();

describe('ad-tracking runtime TikTok/Facebook ordering', () => {
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
});
