import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  activateFacebookPixel,
  facebookPixelReady,
  sendFacebookPixelEvent,
} from './facebook-pixel-client';

let cleanup: (() => void) | undefined;
beforeEach(() => {
  window.history.replaceState({}, '', '/products/phone?color=black');
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
  facebookPixelReady();
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
    ['consent', 'grant'],
    ['set', 'autoConfig', false, '111'],
    ['init', '111'],
  ]);
  expect(
    (window.fbq as typeof window.fbq & { disablePushState: boolean })
      .disablePushState
  ).toBe(true);
});

it('drops obsolete tenant observations while the external SDK is loading', () => {
  window.fbq = vi.fn(); // A new, not-ready SDK identity.
  const old = activateFacebookPixel('111');
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'obsolete' });
  old?.();
  cleanup = activateFacebookPixel('222');
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'current' });
  expect(
    vi.mocked(window.fbq).mock.calls.filter((call) => call[0] === 'trackSingle')
  ).toEqual([]);
  facebookPixelReady();
  expect(
    vi.mocked(window.fbq).mock.calls.filter((call) => call[0] === 'trackSingle')
  ).toEqual([
    ['trackSingle', '222', 'PageView', {}],
    ['trackSingle', '222', 'AddToCart', {}, { eventID: 'current' }],
  ]);
  facebookPixelReady();
  expect(
    vi.mocked(window.fbq).mock.calls.filter((call) => call[0] === 'trackSingle')
  ).toHaveLength(2);
});
it('drops observations revoked before SDK readiness', () => {
  window.fbq = vi.fn();
  cleanup = activateFacebookPixel('111');
  cleanup?.();
  vi.mocked(window.fbq).mockClear();
  facebookPixelReady();
  expect(window.fbq).not.toHaveBeenCalled();
});

it('sends current events after query-only navigation without reactivating the ready pixel', () => {
  cleanup = activateFacebookPixel('111');
  vi.mocked(window.fbq as NonNullable<typeof window.fbq>).mockClear();
  window.history.replaceState({}, '', '/products/phone?color=blue');
  sendFacebookPixelEvent(
    'AddToCart',
    { color: 'blue' },
    { eventID: 'current-query' }
  );
  expect(window.fbq).toHaveBeenCalledExactlyOnceWith(
    'trackSingle',
    '111',
    'AddToCart',
    { color: 'blue' },
    { eventID: 'current-query' }
  );
});
it('drops stale pre-ready URL observations but delivers observations from the current query', () => {
  window.fbq = vi.fn();
  cleanup = activateFacebookPixel('111');
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'old-query' });
  window.history.replaceState({}, '', '/products/phone?color=blue');
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'current-query' });
  facebookPixelReady();
  expect(
    vi.mocked(window.fbq).mock.calls.filter((call) => call[0] === 'trackSingle')
  ).toEqual([
    ['trackSingle', '111', 'AddToCart', {}, { eventID: 'current-query' }],
  ]);
});
it('does not send from a different pathname before the merchant activation catches up', () => {
  cleanup = activateFacebookPixel('111');
  vi.mocked(window.fbq as NonNullable<typeof window.fbq>).mockClear();
  window.history.replaceState({}, '', '/checkout');
  sendFacebookPixelEvent('AddToCart');
  expect(window.fbq).not.toHaveBeenCalled();
});

// Meta's bootstrap stops draining the stub queue as soon as consent locks it.
function loadConsentLockingSdk() {
  const fbq = window.fbq as NonNullable<typeof window.fbq> & {
    queue: unknown[][];
    callMethod?: (...args: unknown[]) => void;
  };
  const delivered: unknown[][] = [];
  let locked = false;
  fbq.callMethod = (...args) => {
    if (args[0] === 'consent') locked = args[1] === 'revoke';
    else if (locked) fbq.queue.push(args);
    else delivered.push(args);
  };
  while (fbq.queue.length && !locked) {
    fbq.callMethod(...(fbq.queue.shift() ?? []));
  }
  facebookPixelReady();
  return { delivered, remaining: fbq.queue };
}

it('initializes and delivers after the real SDK bootstrap consent lock', () => {
  delete window.fbq;
  cleanup = activateFacebookPixel('111');
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'queued' });
  const result = loadConsentLockingSdk();
  expect(result.remaining).toEqual([]);
  expect(result.delivered).toEqual([
    ['set', 'autoConfig', false, '111'],
    ['init', '111'],
    ['trackSingle', '111', 'PageView', {}],
    ['trackSingle', '111', 'AddToCart', {}, { eventID: 'queued' }],
  ]);
});

it('never queues a revoked or replaced pixel initialization before readiness', () => {
  delete window.fbq;
  const old = activateFacebookPixel('111');
  old?.();
  cleanup = activateFacebookPixel('222');
  const result = loadConsentLockingSdk();
  expect(result.remaining).toEqual([]);
  expect(result.delivered).toContainEqual(['init', '222']);
  expect(result.delivered).not.toContainEqual(['init', '111']);
});

it('leaves the bootstrap queue empty when activation is revoked before readiness', () => {
  delete window.fbq;
  cleanup = activateFacebookPixel('111');
  cleanup?.();
  expect(loadConsentLockingSdk()).toEqual({ delivered: [], remaining: [] });
});

it('unlocks the ready SDK before configuring the next active merchant', () => {
  delete window.fbq;
  cleanup = activateFacebookPixel('111');
  const { delivered } = loadConsentLockingSdk();
  cleanup?.();
  delivered.length = 0;
  cleanup = activateFacebookPixel('222');
  expect(delivered).toEqual([
    ['set', 'autoConfig', false, '222'],
    ['init', '222'],
    ['trackSingle', '222', 'PageView', {}],
  ]);
  cleanup?.();
  delivered.length = 0;
  cleanup = activateFacebookPixel('222');
  expect(delivered).toEqual([['trackSingle', '222', 'PageView', {}]]);
});
