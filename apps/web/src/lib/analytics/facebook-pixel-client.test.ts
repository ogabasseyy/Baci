import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  activateFacebookPixel,
  sendFacebookPixelEvent,
} from './facebook-pixel-client';

let cleanup: (() => void) | undefined;
beforeEach(() => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  window.fbq = vi.fn();
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
  delete window.fbq;
});
it('rejects executable and nonnumeric IDs before any SDK call', () => {
  expect(activateFacebookPixel("123');alert(1)//")).toBeUndefined();
  expect(window.fbq).not.toHaveBeenCalled();
});
it('targets only the active merchant and ignores obsolete cleanup', () => {
  const oldCleanup = activateFacebookPixel('111');
  cleanup = activateFacebookPixel('222');
  oldCleanup?.();
  vi.mocked(window.fbq as NonNullable<typeof window.fbq>).mockClear();
  sendFacebookPixelEvent(
    'AddToCart',
    { currency: 'NGN' },
    { eventID: 'stable-id' }
  );
  expect(window.fbq).toHaveBeenCalledExactlyOnceWith(
    'trackSingle',
    '222',
    'AddToCart',
    { currency: 'NGN' },
    { eventID: 'stable-id' }
  );
});
it('regrants cached SDK without duplicate init and denies sends after revocation', () => {
  cleanup = activateFacebookPixel('111');
  cleanup?.();
  vi.mocked(window.fbq as NonNullable<typeof window.fbq>).mockClear();
  cleanup = activateFacebookPixel('111');
  expect(window.fbq).toHaveBeenCalledWith('consent', 'grant');
  expect(window.fbq).not.toHaveBeenCalledWith('init', '111');
  expect(window.fbq).toHaveBeenCalledWith('trackSingle', '111', 'PageView', {});
  vi.mocked(window.fbq as NonNullable<typeof window.fbq>).mockClear();
  localStorage.clear();
  sendFacebookPixelEvent('AddToCart');
  expect(window.fbq).not.toHaveBeenCalled();
});
it('disables automatic configuration before initialization', () => {
  cleanup = activateFacebookPixel('111');
  expect(
    vi
      .mocked(window.fbq as NonNullable<typeof window.fbq>)
      .mock.calls.slice(0, 3)
  ).toEqual([
    ['consent', 'revoke'],
    ['set', 'autoConfig', false, '111'],
    ['init', '111'],
  ]);
  expect(
    (window.fbq as typeof window.fbq & { disablePushState: boolean })
      .disablePushState
  ).toBe(true);
});
