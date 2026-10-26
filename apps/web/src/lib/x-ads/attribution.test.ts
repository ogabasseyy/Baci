import { afterEach, expect, it } from 'vitest';
import { getAdTrackingData } from '@/lib/ad-tracking-cookies';

afterEach(() => localStorage.clear());
it('stores an explicit marketing grant with checkout attribution', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: false,
      marketing: true,
      functional: false,
    })
  );
  expect(getAdTrackingData()).toMatchObject({
    marketingConsent: true,
    chatgptConsent: false,
  });
});
it('does not infer marketing consent from an analytics grant or absent preference', () => {
  expect(getAdTrackingData()).toMatchObject({ marketingConsent: false });
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  expect(getAdTrackingData()).toMatchObject({
    marketingConsent: false,
    chatgptConsent: true,
  });
});
