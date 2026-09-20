import { describe, expect, it, jest } from '@jest/globals';
import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import { trackEvent } from '@/services/analytics-core';
import { initializeQuizMobileAds } from '@/services/initialize-quiz-mobile-ads';
import {
  resetQuizFullscreenOwnershipForTests,
  setQuizRewardedFlowActive,
} from './quiz-fullscreen-ownership';
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

async function flushConsentGate(): Promise<void> {
  // The helper awaits UMP consent before constructing the ad; pump the
  // microtask queue so listeners are registered before firing them.
  for (let flush = 0; flush < 10; flush += 1) {
    await Promise.resolve();
  }
}

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;

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

describe('maybeShowQuizStartInterstitial', () => {
  it('skips while ads are disabled', async () => {
    setAdsEnabled(undefined);
    await expect(maybeShowQuizStartInterstitial()).resolves.toBe('skipped');
    expect(mockInterstitialLoad).not.toHaveBeenCalled();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('shows on load and then caps to one per session', async () => {
    setAdsEnabled('true');
    const first = maybeShowQuizStartInterstitial();
    await flushConsentGate();
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
    for (const listener of listeners.loaded) listener();
    await expect(first).resolves.toBe('shown');
    await expect(maybeShowQuizStartInterstitial()).resolves.toBe('skipped');
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('reserves the session cap while a load is in flight', async () => {
    // Regression: overlapping lobby visits must not create a second
    // interstitial while the first ad is still loading.
    setAdsEnabled('true');
    const first = maybeShowQuizStartInterstitial();
    const second = maybeShowQuizStartInterstitial();
    await flushConsentGate();
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
    for (const listener of listeners.loaded) listener();
    await expect(first).resolves.toBe('shown');
    await expect(second).resolves.toBe('skipped');
    expect(mockInterstitialShow).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('keeps the attempt owned through presentation past the load deadline', async () => {
    // Regression: a load finishing just before the 30s deadline must cancel
    // it — otherwise the timer settles the attempt as skipped while show()
    // can still complete, releasing the session cap for a later visit.
    jest.useFakeTimers();
    try {
      setAdsEnabled('true');
      mockInterstitialShow.mockImplementationOnce(
        () => new Promise<void>(() => {})
      );
      // Never settles by design: show() stays pending past the deadline so
      // the test proves the owned attempt is never released by the timer.
      void maybeShowQuizStartInterstitial();
      await flushConsentGate();
      expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
      for (const listener of listeners.loaded) listener();
      await jest.advanceTimersByTimeAsync(31_000);
      // Still owned: no second load may start while presentation is pending.
      await expect(maybeShowQuizStartInterstitial()).resolves.toBe('skipped');
      expect(mockInterstitialLoad).toHaveBeenCalledTimes(1);
      expect(mockInterstitialShow).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
      setAdsEnabled(ORIGINAL_ENV);
    }
  });

  it('skips when loading errors', async () => {
    setAdsEnabled('true');
    const attempt = maybeShowQuizStartInterstitial();
    await flushConsentGate();
    for (const listener of listeners.error) listener();
    await expect(attempt).resolves.toBe('skipped');
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('abandons a loaded ad when cancelled before presentation', async () => {
    // Regression: a lobby that moves into live play (or unmounts) while the
    // interstitial loads must never have the ad presented over it.
    setAdsEnabled('true');
    const attempt = maybeShowQuizStartInterstitial({
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
    await expect(maybeShowQuizStartInterstitial()).resolves.toBe('skipped');
    expect(mockInterstitialLoad).not.toHaveBeenCalled();
    expect(mockInterstitialShow).not.toHaveBeenCalled();
    mockInitializeQuizMobileAds.mockResolvedValue({ canRequestAds: true });
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('skips when the native ads module is unavailable', async () => {
    setAdsEnabled('true');
    mockIsQuizMobileAdsAvailable.mockReturnValueOnce(false);
    await expect(maybeShowQuizStartInterstitial()).resolves.toBe('skipped');
    expect(mockInitializeQuizMobileAds).not.toHaveBeenCalled();
    expect(mockInterstitialLoad).not.toHaveBeenCalled();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('defers to an active rewarded flow instead of presenting over it', async () => {
    // Regression: when the shopper taps "Watch ad" while the interstitial
    // is loading, the late LOADED event must abandon instead of racing the
    // rewarded ad for the full screen.
    setAdsEnabled('true');
    const attempt = maybeShowQuizStartInterstitial();
    await flushConsentGate();
    setQuizRewardedFlowActive(true);
    for (const listener of listeners.loaded) listener();
    await expect(attempt).resolves.toBe('skipped');
    expect(mockInterstitialShow).not.toHaveBeenCalled();
    setQuizRewardedFlowActive(false);
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('reports paid events with the interstitial placement', async () => {
    // Regression: interstitial revenue must reach mobile_ad_paid like the
    // banner placements do, or placement-level reporting undercounts it.
    setAdsEnabled('true');
    const attempt = maybeShowQuizStartInterstitial();
    await flushConsentGate();
    for (const listener of listeners.paid) {
      listener({ currency: 'USD', precision: 1, value: 0.000_02 });
    }
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'mobile_ad_paid',
      expect.objectContaining({
        currency: 'USD',
        format: 'interstitial',
        placement: 'QUIZ_START_INTERSTITIAL',
      })
    );
    for (const listener of listeners.loaded) listener();
    await expect(attempt).resolves.toBe('shown');
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('unsubscribes every listener when the presented interstitial closes', async () => {
    // Regression: the close path settled without releasing native
    // subscriptions, leaking listeners after every dismissal.
    setAdsEnabled('true');
    const onClosed = jest.fn();
    const attempt = maybeShowQuizStartInterstitial({ onClosed });
    await flushConsentGate();
    for (const listener of listeners.loaded) listener();
    await expect(attempt).resolves.toBe('shown');
    expect(unsubscribes).toHaveLength(4);
    for (const unsubscribe of unsubscribes) {
      expect(unsubscribe).not.toHaveBeenCalled();
    }
    for (const listener of listeners.closed) listener();
    for (const unsubscribe of unsubscribes) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
    expect(onClosed).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('unsubscribes every listener when an owned presentation fails', async () => {
    // Regression: a rejected show() settled the owned attempt without
    // releasing listeners, and no CLOSED ever arrives to clean up.
    setAdsEnabled('true');
    mockInterstitialShow.mockRejectedValueOnce(new Error('dismissed'));
    const attempt = maybeShowQuizStartInterstitial();
    await flushConsentGate();
    for (const listener of listeners.loaded) listener();
    await expect(attempt).resolves.toBe('skipped');
    expect(unsubscribes).toHaveLength(4);
    for (const unsubscribe of unsubscribes) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('notifies the host synchronously when presentation begins', async () => {
    // Regression: show() resolves over a native bridge round-trip after
    // presentation begins; the host must claim fullscreen ownership in
    // the LOADED handler rather than after the helper promise resolves.
    setAdsEnabled('true');
    mockInterstitialShow.mockImplementationOnce(
      () => new Promise<void>(() => {})
    );
    const onPresenting = jest.fn();
    void maybeShowQuizStartInterstitial({ onPresenting });
    await flushConsentGate();
    for (const listener of listeners.loaded) listener();
    expect(mockInterstitialShow).toHaveBeenCalledTimes(1);
    expect(onPresenting).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });

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
