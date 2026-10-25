import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredConsent } from '@/lib/consent-mode';
import { useCookieConsentController } from './use-cookie-consent-controller';

describe('useCookieConsentController', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('persists edited categories and publishes only the saved choice', () => {
    const onConsent = vi.fn();
    window.addEventListener('cookie-consent-updated', onConsent);
    try {
      const { result } = renderHook(useCookieConsentController);
      act(() => vi.advanceTimersByTime(1000));
      expect(result.current.isVisible).toBe(true);
      act(() => {
        result.current.setShowDetails(true);
        result.current.setPreferences((previous) => ({
          ...previous,
          analytics: true,
          functional: false,
        }));
      });
      expect(result.current.showDetails).toBe(true);
      expect(getStoredConsent()).toBeNull();
      act(() => result.current.savePreferences());
      expect(getStoredConsent()).toMatchObject({
        necessary: true,
        analytics: true,
        marketing: false,
        functional: false,
      });
      expect(onConsent).toHaveBeenCalledTimes(1);
      expect(onConsent.mock.calls[0][0].detail).toEqual({
        necessary: true,
        analytics: true,
        marketing: false,
        functional: false,
      });
      expect(result.current.isClosing).toBe(true);
      act(() => vi.advanceTimersByTime(200));
      expect(result.current.isVisible).toBe(false);
    } finally {
      window.removeEventListener('cookie-consent-updated', onConsent);
    }
  });

  it('retains the prompt without granting consent after a failed write and permits retry', () => {
    const gtag = vi.fn();
    vi.stubGlobal('gtag', gtag);
    const writeConsent = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Storage full', 'QuotaExceededError');
      });
    const { result } = renderHook(useCookieConsentController);
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.acceptAll());
    expect(result.current.hasStorageError).toBe(true);
    expect(result.current.isVisible).toBe(true);
    expect(result.current.isClosing).toBe(false);
    expect(getStoredConsent()).toBeNull();
    expect(gtag).not.toHaveBeenCalled();
    writeConsent.mockRestore();
    act(() => result.current.acceptNecessary());
    expect(result.current.hasStorageError).toBe(false);
    expect(getStoredConsent()).toMatchObject({
      analytics: false,
      marketing: false,
    });
  });

  it('offers consent when reading storage is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    const { result } = renderHook(useCookieConsentController);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.isVisible).toBe(true);
    expect(result.current.preferences).toMatchObject({
      analytics: false,
      marketing: false,
    });
  });

  it.each([
    'null',
    '[]',
    JSON.stringify({
      necessary: true,
      analytics: false,
      marketing: 'false',
      functional: true,
    }),
    JSON.stringify({ analytics: true }),
  ])('offers a fresh prompt for invalid stored preferences %s', (saved) => {
    localStorage.setItem('baci-cookie-consent', saved);
    const { result } = renderHook(useCookieConsentController);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.isVisible).toBe(true);
    expect(result.current.preferences.marketing).toBe(false);
  });

  it('cancels the pending prompt timer on unmount', () => {
    const { unmount } = renderHook(useCookieConsentController);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the pending exit timer on unmount', () => {
    const { result, unmount } = renderHook(useCookieConsentController);
    act(() => vi.advanceTimersByTime(1000));
    const schedule = vi.spyOn(window, 'setTimeout');
    const cancel = vi.spyOn(window, 'clearTimeout');
    act(() => result.current.acceptAll());
    const exitTimerIndex = schedule.mock.calls.findIndex(
      ([, delay]) => delay === 200
    );
    expect(exitTimerIndex).toBeGreaterThanOrEqual(0);
    const exitTimer = schedule.mock.results[exitTimerIndex].value;
    unmount();
    expect(cancel).toHaveBeenCalledWith(exitTimer);
  });
});
