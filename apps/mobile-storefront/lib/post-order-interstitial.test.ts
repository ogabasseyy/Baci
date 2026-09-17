import { describe, expect, it, jest } from '@jest/globals';
import {
  maybeShowPostOrderInterstitial,
  resetPostOrderInterstitialForTests,
} from './post-order-interstitial';

jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));

type Listener = () => void;

const listeners: Record<string, Listener[]> = {
  closed: [],
  error: [],
  loaded: [],
};

const mockInterstitialShow = jest.fn<(...args: unknown[]) => Promise<void>>(
  async () => undefined
);
const mockInterstitialLoad = jest.fn<(...args: unknown[]) => void>(
  () => undefined
);

jest.mock('react-native-google-mobile-ads', () => ({
  AdEventType: { CLOSED: 'closed', ERROR: 'error', LOADED: 'loaded' },
  InterstitialAd: {
    createForAdRequest: () => ({
      addAdEventListener: (type: string, listener: Listener) => {
        listeners[type]?.push(listener);
        return jest.fn();
      },
      load: (...args: unknown[]) => mockInterstitialLoad(...args),
      show: (...args: unknown[]) => mockInterstitialShow(...args),
    }),
  },
}));

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;

function setAdsEnabled(value: string | undefined) {
  for (const key of Object.keys(listeners)) listeners[key] = [];
  mockInterstitialLoad.mockClear();
  mockInterstitialShow.mockClear();
  resetPostOrderInterstitialForTests();
  if (value === undefined) {
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = value;
  }
}

describe('maybeShowPostOrderInterstitial', () => {
  it('skips while ads are disabled', async () => {
    setAdsEnabled(undefined);
    await expect(maybeShowPostOrderInterstitial()).resolves.toBe('skipped');
    expect(mockInterstitialLoad).not.toHaveBeenCalled();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('shows on load and then caps to one per session', async () => {
    setAdsEnabled('true');
    const first = maybeShowPostOrderInterstitial();
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
    for (const listener of listeners.loaded) listener();
    await expect(first).resolves.toBe('shown');
    await expect(maybeShowPostOrderInterstitial()).resolves.toBe('skipped');
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('skips when loading errors', async () => {
    setAdsEnabled('true');
    const attempt = maybeShowPostOrderInterstitial();
    for (const listener of listeners.error) listener();
    await expect(attempt).resolves.toBe('skipped');
    setAdsEnabled(ORIGINAL_ENV);
  });
});
