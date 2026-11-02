import { afterEach, expect, it } from 'vitest';
import { getSocialMarketingConsent } from './get-social-marketing-consent';

afterEach(() => localStorage.clear());
it('grants marketing only with a valid stored affirmative choice', () => {
  expect(getSocialMarketingConsent()).toBe(false);
  localStorage.setItem('baci-cookie-consent', '{broken');
  expect(getSocialMarketingConsent()).toBe(false);
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    })
  );
  expect(getSocialMarketingConsent()).toBe(false);
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  expect(getSocialMarketingConsent()).toBe(true);
});
