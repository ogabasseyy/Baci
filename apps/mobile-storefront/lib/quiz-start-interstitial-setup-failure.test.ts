import { describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from '@/services/analytics-core';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';
import { resetQuizFullscreenOwnershipForTests } from './quiz-fullscreen-ownership';
import {
  maybeShowQuizStartInterstitial,
  resetQuizStartInterstitialForTests,
} from './quiz-start-interstitial';

jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('@/components/quiz/is-quiz-mobile-ads-available', () => ({
  isQuizMobileAdsAvailable: jest.fn(() => true),
}));

jest.mock('@/services/initialize-quiz-mobile-ads', () => ({
  initializeQuizMobileAds: jest.fn(async () => ({ canRequestAds: true })),
}));

const mockInitializeQuizMobileAds = jest.mocked(initializeQuizMobileAds);
const mockTrackEvent = jest.mocked(trackEvent);

type Listener = (...args: unknown[]) => void;

const listeners: Record<string, Listener[]> = {
  closed: [],
  error: [],
  loaded: [],
  paid: [],
};
const unsubscribes: ReturnType<typeof jest.fn>[] = [];

const mockInterstitialShow = jest.fn<(...args: unknown[]) => Promise<void>>(
  async () => undefined
);
const mockInterstitialLoad = jest.fn<(...args: unknown[]) => void>(
  () => undefined
);

jest.mock('react-native-google-mobile-ads', () => ({
  AdEventType: {
    CLOSED: 'closed',
    ERROR: 'error',
    LOADED: 'loaded',
    PAID: 'paid',
  },
  InterstitialAd: {
    createForAdRequest: () => ({
      addAdEventListener: (type: string, listener: Listener) => {
        listeners[type]?.push(listener);
        const unsubscribe = jest.fn();
        unsubscribes.push(unsubscribe);
        return unsubscribe;
      },
      load: (...args: unknown[]) => mockInterstitialLoad(...args),
      show: (...args: unknown[]) => mockInterstitialShow(...args),
    }),
  },
}));

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;

async function flushConsentGate(): Promise<void> {
  // The helper awaits UMP consent before constructing the ad; pump the
  // microtask queue so listeners are registered before firing them.
  for (let flush = 0; flush < 10; flush += 1) {
    await Promise.resolve();
  }
}

function setAdsEnabled(value: string | undefined) {
  for (const key of Object.keys(listeners)) listeners[key] = [];
  unsubscribes.length = 0;
  mockInterstitialLoad.mockClear();
  mockInterstitialShow.mockClear();
  mockInitializeQuizMobileAds.mockClear();
  mockTrackEvent.mockClear();
  resetQuizStartInterstitialForTests();
  resetQuizFullscreenOwnershipForTests();
  if (value === undefined) {
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = value;
  }
}

describe('maybeShowQuizStartInterstitial setup failure', () => {
  it('releases the timer and listeners when setup throws synchronously', async () => {
    // Regression: a synchronous load() throw settled the attempt as skipped
    // while leaving settled false, the 30s timer running, and every native
    // listener subscribed — a late LOADED from the zombie instance could
    // present an ad or reset a new attempt's reservation.
    jest.useFakeTimers();
    try {
      setAdsEnabled('true');
      mockInterstitialLoad.mockImplementationOnce(() => {
        throw new Error('native load failed');
      });
      await expect(maybeShowQuizStartInterstitial()).resolves.toBe('skipped');
      expect(unsubscribes).toHaveLength(4);
      for (const unsubscribe of unsubscribes) {
        expect(unsubscribe).toHaveBeenCalledTimes(1);
      }
      // The zombie instance is inert: a late load event cannot present, the
      // deadline fires nothing, and the reservation is released for retry.
      for (const listener of listeners.loaded) listener();
      await jest.advanceTimersByTimeAsync(31_000);
      expect(mockInterstitialShow).not.toHaveBeenCalled();
      expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
      mockInterstitialLoad.mockClear();
      const retry = maybeShowQuizStartInterstitial();
      await flushConsentGate();
      expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
      for (const listener of listeners.loaded) listener();
      await expect(retry).resolves.toBe('shown');
      expect(mockInterstitialShow).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
      setAdsEnabled(ORIGINAL_ENV);
    }
  });
});
