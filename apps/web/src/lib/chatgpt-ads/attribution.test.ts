import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdTrackingData } from '@/lib/ad-tracking-cookies';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('ChatGPT checkout attribution consent', () => {
  it('includes SDK references only after measurement consent', () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue(
      '__oppref=opaque-click; __obref=opaque-browser'
    );
    expect(getAdTrackingData()).toMatchObject({ chatgptConsent: false });
    expect(getAdTrackingData()).not.toHaveProperty('oppref');
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
      oppref: 'opaque-click',
      obref: 'opaque-browser',
      chatgptConsent: true,
    });
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({ analytics: false })
    );
    expect(getAdTrackingData()).not.toHaveProperty('obref');
  });
  it('fails closed for malformed stored consent', () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue(
      '__oppref=opaque-click'
    );
    localStorage.setItem('baci-cookie-consent', '{');
    expect(getAdTrackingData()).toMatchObject({ chatgptConsent: false });
    expect(getAdTrackingData()).not.toHaveProperty('oppref');
  });
});
