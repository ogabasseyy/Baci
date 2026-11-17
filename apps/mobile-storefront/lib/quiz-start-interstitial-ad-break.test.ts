import { describe, expect, it, jest } from '@jest/globals';
import {
  flushConsentGate,
  maybeShowQuizStartInterstitial,
  mockInterstitialLoad,
  mockInterstitialShow,
  mockListeners,
  ORIGINAL_ENV,
  setAdsEnabled,
} from './quiz-start-interstitial-test-harness';

describe('bugfix: the ad appeared over an interactive waiting room', () => {
  it('waits for the host notice before claiming and presenting', async () => {
    setAdsEnabled('true');
    let endNotice: () => void = () => undefined;
    const onPresenting = jest.fn();
    const pending = maybeShowQuizStartInterstitial({
      beforePresent: () =>
        new Promise<void>((resolve) => {
          endNotice = resolve;
        }),
      onPresenting,
    });
    await flushConsentGate();
    for (const listener of mockListeners.loaded) listener();
    await flushConsentGate();

    expect(onPresenting).not.toHaveBeenCalled();
    expect(mockInterstitialShow).not.toHaveBeenCalled();

    endNotice();
    await expect(pending).resolves.toBe('shown');
    expect(onPresenting).toHaveBeenCalledTimes(1);
    expect(mockInterstitialShow).toHaveBeenCalledTimes(1);
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('does not let the load deadline abandon an ad that loaded before the notice', async () => {
    // Regression: the 30s load timer stayed armed through the notice, so a
    // load finishing near the deadline was abandoned mid-notice.
    jest.useFakeTimers();
    try {
      setAdsEnabled('true');
      let endNotice: () => void = () => undefined;
      const pending = maybeShowQuizStartInterstitial({
        beforePresent: () =>
          new Promise<void>((resolve) => {
            endNotice = resolve;
          }),
      });
      await flushConsentGate();
      await jest.advanceTimersByTimeAsync(29_000);
      for (const listener of mockListeners.loaded) listener();
      await jest.advanceTimersByTimeAsync(2_000);

      endNotice();
      await expect(pending).resolves.toBe('shown');
      expect(mockInterstitialShow).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
      setAdsEnabled(ORIGINAL_ENV);
    }
  });

  it('releases the reservation when a host notice never settles', async () => {
    // Regression: with the load deadline cleared for the notice, a host
    // that never resolved left the attempt 'loading' for the session.
    jest.useFakeTimers();
    try {
      setAdsEnabled('true');
      const pending = maybeShowQuizStartInterstitial({
        beforePresent: () => new Promise<void>(() => {}),
      });
      await flushConsentGate();
      for (const listener of mockListeners.loaded) listener();
      await jest.advanceTimersByTimeAsync(5_001);

      await expect(pending).resolves.toBe('skipped');
      expect(mockInterstitialShow).not.toHaveBeenCalled();
      const retry = maybeShowQuizStartInterstitial();
      await flushConsentGate();
      expect(mockInterstitialLoad).toHaveBeenCalledTimes(2);
      for (const listener of mockListeners.loaded) listener();
      await expect(retry).resolves.toBe('shown');
    } finally {
      jest.useRealTimers();
      setAdsEnabled(ORIGINAL_ENV);
    }
  });

  it('abandons without using the session cap when cancelled during the notice', async () => {
    setAdsEnabled('true');
    let cancelled = false;
    let endNotice: () => void = () => undefined;
    const pending = maybeShowQuizStartInterstitial({
      beforePresent: () =>
        new Promise<void>((resolve) => {
          endNotice = resolve;
        }),
      isCancelled: () => cancelled,
    });
    await flushConsentGate();
    for (const listener of mockListeners.loaded) listener();
    cancelled = true;
    endNotice();

    await expect(pending).resolves.toBe('skipped');
    expect(mockInterstitialShow).not.toHaveBeenCalled();
    // The cap stays free: a later visit can still load an ad.
    const retry = maybeShowQuizStartInterstitial();
    await flushConsentGate();
    expect(mockInterstitialLoad).toHaveBeenCalledTimes(2);
    for (const listener of mockListeners.loaded) listener();
    await expect(retry).resolves.toBe('shown');
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('abandons when the host notice fails', async () => {
    setAdsEnabled('true');
    const pending = maybeShowQuizStartInterstitial({
      beforePresent: () => Promise.reject(new Error('notice failed')),
    });
    await flushConsentGate();
    for (const listener of mockListeners.loaded) listener();

    await expect(pending).resolves.toBe('skipped');
    expect(mockInterstitialShow).not.toHaveBeenCalled();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('does not present when the load errors while the notice is up', async () => {
    setAdsEnabled('true');
    let endNotice: () => void = () => undefined;
    const pending = maybeShowQuizStartInterstitial({
      beforePresent: () =>
        new Promise<void>((resolve) => {
          endNotice = resolve;
        }),
    });
    await flushConsentGate();
    for (const listener of mockListeners.loaded) listener();
    for (const listener of mockListeners.error) listener();
    endNotice();

    await expect(pending).resolves.toBe('skipped');
    expect(mockInterstitialShow).not.toHaveBeenCalled();
    setAdsEnabled(ORIGINAL_ENV);
  });
});
