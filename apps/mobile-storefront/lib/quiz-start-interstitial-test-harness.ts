import { jest } from '@jest/globals';
import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { trackEvent } from '@/services/analytics-core';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';
import { resetQuizFullscreenOwnershipForTests } from './quiz-fullscreen-ownership';
import { resetQuizStartInterstitialForTests } from './quiz-start-interstitial';

export { maybeShowQuizStartInterstitial } from './quiz-start-interstitial';

jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('@/components/quiz/is-quiz-mobile-ads-available', () => ({
  isQuizMobileAdsAvailable: jest.fn(() => true),
}));

jest.mock('@/services/initialize-quiz-mobile-ads', () => ({
  initializeQuizMobileAds: jest.fn(async () => ({ canRequestAds: true })),
}));

export const mockIsQuizMobileAdsAvailable = jest.mocked(
  isQuizMobileAdsAvailable
);
export const mockInitializeQuizMobileAds = jest.mocked(initializeQuizMobileAds);
export const mockTrackEvent = jest.mocked(trackEvent);

type Listener = (...args: unknown[]) => void;

export const mockListeners: Record<string, Listener[]> = {
  closed: [],
  error: [],
  loaded: [],
  paid: [],
};
export const mockUnsubscribes: ReturnType<typeof jest.fn>[] = [];

export const mockInterstitialShow = jest.fn<
  (...args: unknown[]) => Promise<void>
>(async () => undefined);
export const mockInterstitialLoad = jest.fn<(...args: unknown[]) => void>(
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
        mockListeners[type]?.push(listener);
        const unsubscribe = jest.fn();
        mockUnsubscribes.push(unsubscribe);
        return unsubscribe;
      },
      load: (...args: unknown[]) => mockInterstitialLoad(...args),
      show: (...args: unknown[]) => mockInterstitialShow(...args),
    }),
  },
}));

export async function flushConsentGate(): Promise<void> {
  // The helper awaits UMP consent before constructing the ad; pump the
  // microtask queue so listeners are registered before firing them.
  for (let flush = 0; flush < 10; flush += 1) {
    await Promise.resolve();
  }
}

export const ORIGINAL_ENV = process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;

export function setAdsEnabled(value: string | undefined) {
  for (const key of Object.keys(mockListeners)) mockListeners[key] = [];
  mockUnsubscribes.length = 0;
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
