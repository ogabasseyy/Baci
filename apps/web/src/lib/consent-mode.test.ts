import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyStoredConsent,
  getStoredConsent,
  initializeConsentMode,
} from './consent-mode';

const preferences = {
  necessary: true,
  analytics: true,
  marketing: true,
  functional: true,
};
describe('stored Google consent', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('dataLayer', []);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    JSON.stringify({ ...preferences, analytics: 'false', marketing: 'false' }),
    JSON.stringify({ ...preferences, functional: 1 }),
    JSON.stringify({ analytics: true, marketing: true, functional: true }),
    'null',
    '[]',
    '{broken-json',
  ])('keeps default analytics and ads denied for malformed stored consent %s', (saved) => {
    localStorage.setItem('baci-cookie-consent', saved);
    initializeConsentMode();
    const defaults = Array.from(window.dataLayer[0] as ArrayLike<unknown>);
    expect(defaults[2]).toMatchObject({
      analytics_storage: 'denied',
      ad_storage: 'denied',
    });
    const gtag = vi.spyOn(window, 'gtag');
    applyStoredConsent();
    expect(gtag).not.toHaveBeenCalled();
    expect(getStoredConsent()).toBeNull();
  });

  it.each([
    true,
    false,
  ])('applies valid saved choices with analytics and marketing=%s', (accepted) => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        ...preferences,
        analytics: accepted,
        marketing: accepted,
        timestamp: '2026-10-25T00:00:00Z',
      })
    );
    const gtag = vi.fn();
    vi.stubGlobal('gtag', gtag);
    expect(getStoredConsent()).toMatchObject({
      analytics: accepted,
      marketing: accepted,
      functional: true,
    });
    applyStoredConsent();
    expect(gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({
        analytics_storage: accepted ? 'granted' : 'denied',
        ad_storage: accepted ? 'granted' : 'denied',
        ad_user_data: accepted ? 'granted' : 'denied',
        ad_personalization: accepted ? 'granted' : 'denied',
      })
    );
  });

  it('keeps consent denied when browser storage access fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    const gtag = vi.fn();
    vi.stubGlobal('gtag', gtag);
    applyStoredConsent();
    expect(gtag).not.toHaveBeenCalled();
    expect(getStoredConsent()).toBeNull();
  });
});
