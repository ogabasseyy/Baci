import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOKIE_CONSENT_KEY } from './cookie-consent-types';
import { isCookieAllowed } from './is-cookie-allowed';

describe('isCookieAllowed', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('returns the chosen category and denies omitted categories', () => {
    localStorage.setItem(
      COOKIE_CONSENT_KEY,
      JSON.stringify({ analytics: true, marketing: false })
    );
    expect(isCookieAllowed('analytics')).toBe(true);
    expect(isCookieAllowed('marketing')).toBe(false);
    expect(isCookieAllowed('functional')).toBe(false);
  });
  it.each([
    null,
    '{broken-json',
  ])('denies absent or malformed consent %s', (saved) => {
    if (saved !== null) localStorage.setItem(COOKIE_CONSENT_KEY, saved);
    expect(isCookieAllowed('analytics')).toBe(false);
  });
  it('denies consent when storage access throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    expect(isCookieAllowed('analytics')).toBe(false);
  });
});
