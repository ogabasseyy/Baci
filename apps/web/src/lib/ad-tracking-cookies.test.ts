import { afterEach, expect, it, vi } from 'vitest';
import {
  getAdTrackingData,
  parseAdTrackingCookies,
} from './ad-tracking-cookies';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it('ignores unrelated cookies that are not URI encoded', () => {
  expect(
    parseAdTrackingCookies(
      'unrelated_promotion=20%off; __oppref=click%2Fone; __obref=browser'
    )
  ).toMatchObject({ oppref: 'click/one', obref: 'browser' });
});
it('omits malformed attribution without losing other valid references', () => {
  const parsed = parseAdTrackingCookies(
    '__oppref=bad%escape; __obref=browser; _fbp=fb%2Ereference'
  );
  expect(parsed.oppref).toBeUndefined();
  expect(parsed).toMatchObject({ obref: 'browser', fbp: 'fb.reference' });
});
it('allows checkout when cookie access itself is unavailable', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => {
    throw new Error('cookies unavailable');
  });
  expect(getAdTrackingData()).toMatchObject({ chatgptConsent: true });
});
