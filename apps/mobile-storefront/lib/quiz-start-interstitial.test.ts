import { describe, expect, it, jest } from '@jest/globals';
import { setQuizRewardedFlowActive } from './quiz-fullscreen-ownership';
import {
  flushConsentGate,
  maybeShowQuizStartInterstitial,
  mockInitializeQuizMobileAds,
  mockInterstitialLoad,
  mockInterstitialShow,
  mockIsQuizMobileAdsAvailable,
  mockListeners,
  mockTrackEvent,
  mockUnsubscribes,
  ORIGINAL_ENV,
  setAdsEnabled,
} from './quiz-start-interstitial-test-harness';

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
    for (const listener of mockListeners.loaded) listener();
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
    for (const listener of mockListeners.loaded) listener();
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
      for (const listener of mockListeners.loaded) listener();
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
    for (const listener of mockListeners.error) listener();
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
    for (const listener of mockListeners.loaded) listener();
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
    for (const listener of mockListeners.loaded) listener();
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
    for (const listener of mockListeners.paid) {
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
    for (const listener of mockListeners.loaded) listener();
    await expect(attempt).resolves.toBe('shown');
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('unsubscribes every listener when the presented interstitial closes', async () => {
    // Regression: the close path settled without releasing native
    // subscriptions, leaking mockListeners after every dismissal.
    setAdsEnabled('true');
    const onClosed = jest.fn();
    const attempt = maybeShowQuizStartInterstitial({ onClosed });
    await flushConsentGate();
    for (const listener of mockListeners.loaded) listener();
    await expect(attempt).resolves.toBe('shown');
    expect(mockUnsubscribes).toHaveLength(4);
    for (const unsubscribe of mockUnsubscribes) {
      expect(unsubscribe).not.toHaveBeenCalled();
    }
    for (const listener of mockListeners.closed) listener();
    for (const unsubscribe of mockUnsubscribes) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
    expect(onClosed).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('unsubscribes every listener when an owned presentation fails', async () => {
    // Regression: a rejected show() settled the owned attempt without
    // releasing mockListeners, and no CLOSED ever arrives to clean up.
    setAdsEnabled('true');
    mockInterstitialShow.mockRejectedValueOnce(new Error('dismissed'));
    const attempt = maybeShowQuizStartInterstitial();
    await flushConsentGate();
    for (const listener of mockListeners.loaded) listener();
    await expect(attempt).resolves.toBe('skipped');
    expect(mockUnsubscribes).toHaveLength(4);
    for (const unsubscribe of mockUnsubscribes) {
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
    for (const listener of mockListeners.loaded) listener();
    expect(mockInterstitialShow).toHaveBeenCalledTimes(1);
    expect(onPresenting).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });
});
