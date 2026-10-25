import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOKIE_CONSENT_KEY } from './cookie-consent-types';
import { useCookieConsent } from './use-cookie-consent';

const preferences = {
  necessary: true,
  analytics: true,
  marketing: false,
  functional: true,
};
describe('useCookieConsent', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it('reads saved preferences and follows same-tab consent changes', () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(preferences));
    const { result } = renderHook(useCookieConsent);
    expect(result.current).toEqual(preferences);
    act(() => {
      localStorage.setItem(
        COOKIE_CONSENT_KEY,
        JSON.stringify({ ...preferences, analytics: false })
      );
      window.dispatchEvent(new Event('cookie-consent-updated'));
    });
    expect(result.current?.analytics).toBe(false);
  });
  it.each([
    null,
    '{broken-json',
    'null',
    '[]',
    JSON.stringify({ ...preferences, marketing: 'false' }),
    JSON.stringify({ ...preferences, analytics: 1 }),
    JSON.stringify({ analytics: true }),
  ])('returns no consent for absent or malformed storage %s', (saved) => {
    if (saved !== null) localStorage.setItem(COOKIE_CONSENT_KEY, saved);
    expect(renderHook(useCookieConsent).result.current).toBeNull();
  });
  it('returns no consent when storage access throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    expect(renderHook(useCookieConsent).result.current).toBeNull();
  });
});
