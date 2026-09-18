import { describe, expect, it, jest } from '@jest/globals';
import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { trackEvent } from '@/services/analytics-core';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';
import {
  maybeShowPostOrderInterstitial,
  resetPostOrderInterstitialForTests,
} from './post-order-interstitial';

jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('@/components/quiz/is-quiz-mobile-ads-available', () => ({
  isQuizMobileAdsAvailable: jest.fn(() => true),
}));

jest.mock('@/services/initialize-quiz-mobile-ads', () => ({
  initializeQuizMobileAds: jest.fn(async () => ({ canRequestAds: true })),
}));

const mockIsQuizMobileAdsAvailable = jest.mocked(isQuizMobileAdsAvailable);
const mockInitializeQuizMobileAds = jest.mocked(initializeQuizMobileAds);
const mockTrackEvent = jest.mocked(trackEvent);

type Listener = (...args: unknown[]) => void;

const listeners: Record<string, Listener[]> = {
  closed: [],
  error: [],
  loaded: [],
  paid: [],
};

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
        return jest.fn();
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
  mockInterstitialLoad.mockClear();
  mockInterstitialShow.mockClear();
  mockInitializeQuizMobileAds.mockClear();
  mockTrackEvent.mockClear();
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
    await flushConsentGate();
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
    for (const listener of listeners.loaded) listener();
    await expect(first).resolves.toBe('shown');
    await expect(maybeShowPostOrderInterstitial()).resolves.toBe('skipped');
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('reserves the session cap while a load is in flight', async () => {
    // Regression: a rapid remount must not create a second interstitial
    // while the first ad is still loading; the loser abandons as skipped.
    setAdsEnabled('true');
    const first = maybeShowPostOrderInterstitial();
    const second = maybeShowPostOrderInterstitial();
    await flushConsentGate();
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
    for (const listener of listeners.loaded) listener();
    await expect(first).resolves.toBe('shown');
    await expect(second).resolves.toBe('skipped');
    expect(mockInterstitialShow).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('skips when loading errors', async () => {
    setAdsEnabled('true');
    const attempt = maybeShowPostOrderInterstitial();
    await flushConsentGate();
    for (const listener of listeners.error) listener();
    await expect(attempt).resolves.toBe('skipped');
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('abandons a loaded ad when cancelled before presentation', async () => {
    // A shopper who leaves order success while the ad loads must never see
    // it presented over an unrelated screen.
    setAdsEnabled('true');
    const attempt = maybeShowPostOrderInterstitial({
      isCancelled: () => true,
    });
    await flushConsentGate();
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
    for (const listener of listeners.loaded) listener();
    await expect(attempt).resolves.toBe('skipped');
    expect(mockInterstitialShow).not.toHaveBeenCalled();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('skips before requesting when consent is unresolved', async () => {
    setAdsEnabled('true');
    mockInitializeQuizMobileAds.mockResolvedValueOnce({
      canRequestAds: false,
    });
    await expect(maybeShowPostOrderInterstitial()).resolves.toBe('skipped');
    expect(mockInterstitialLoad).not.toHaveBeenCalled();
    expect(mockInterstitialShow).not.toHaveBeenCalled();
    mockInitializeQuizMobileAds.mockResolvedValue({ canRequestAds: true });
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('skips when the native ads module is unavailable', async () => {
    setAdsEnabled('true');
    mockIsQuizMobileAdsAvailable.mockReturnValueOnce(false);
    await expect(maybeShowPostOrderInterstitial()).resolves.toBe('skipped');
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
    expect(mockInterstitialLoad).not.toHaveBeenCalled();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('reports paid events with the interstitial placement', async () => {
    // Regression: interstitial revenue must reach mobile_ad_paid like the
    // banner placements do, or placement-level reporting undercounts it.
    setAdsEnabled('true');
    const attempt = maybeShowPostOrderInterstitial();
    await flushConsentGate();
    for (const listener of listeners.paid) {
      listener({ currency: 'USD', precision: 1, value: 0.000_02 });
    }
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'mobile_ad_paid',
      expect.objectContaining({
        currency: 'USD',
        format: 'interstitial',
        placement: 'POST_ORDER_INTERSTITIAL',
      })
    );
    for (const listener of listeners.loaded) listener();
    await expect(attempt).resolves.toBe('shown');
    setAdsEnabled(ORIGINAL_ENV);
  });
});
