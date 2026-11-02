import { afterEach, expect, it, vi } from 'vitest';
import {
  activateFacebookPixel,
  facebookPixelReady,
  prepareFacebookPixel,
  sendFacebookPixelEvent,
} from './facebook-pixel-client';

afterEach(() => {
  localStorage.clear();
  delete window.fbq;
});

it('revokes an activated ready SDK when prepared ownership is released first', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    })
  );
  const fbq = vi.fn();
  window.fbq = fbq;
  const release = prepareFacebookPixel('111', 'merchant-a');
  const active = activateFacebookPixel('111', 'merchant-a');
  facebookPixelReady();
  fbq.mockClear();
  release?.();
  active?.();
  expect(fbq).toHaveBeenCalledExactlyOnceWith('consent', 'revoke');
});

it('flushes prepared events after activation of an already-ready SDK without duplicate consent grant', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    })
  );
  const fbq = vi.fn();
  window.fbq = fbq;
  facebookPixelReady();
  const release = prepareFacebookPixel('111', 'merchant-a');
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'cached-sdk-event' });
  const active = activateFacebookPixel('111', 'merchant-a');
  expect(
    fbq.mock.calls.filter(
      ([name, action]) => name === 'consent' && action === 'grant'
    )
  ).toHaveLength(1);
  expect(fbq).toHaveBeenCalledWith(
    'trackSingle',
    '111',
    'AddToCart',
    {},
    { eventID: 'cached-sdk-event' }
  );
  active?.();
  release?.();
});

it('retains a consented event emitted after ownership is prepared but before the deferred wrapper mounts', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    })
  );
  const fbq = vi.fn();
  window.fbq = fbq;
  const releasePrepared = prepareFacebookPixel('111', 'merchant-a');
  sendFacebookPixelEvent(
    'AddToCart',
    { currency: 'NGN' },
    { eventID: 'early-event' }
  );
  const releaseActive = activateFacebookPixel('111', 'merchant-a');
  facebookPixelReady();
  expect(fbq).toHaveBeenCalledWith(
    'trackSingle',
    '111',
    'AddToCart',
    { currency: 'NGN' },
    { eventID: 'early-event' }
  );
  releaseActive?.();
  releasePrepared?.();
});

it('never forwards queued events to a new merchant sharing the same pixel ID', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    })
  );
  const fbq = vi.fn();
  window.fbq = fbq;
  const old = prepareFacebookPixel('111', 'merchant-a');
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'old-event' });
  const current = prepareFacebookPixel('111', 'merchant-b');
  old?.();
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'new-event' });
  const active = activateFacebookPixel('111', 'merchant-b');
  facebookPixelReady();
  expect(fbq).not.toHaveBeenCalledWith(
    'trackSingle',
    '111',
    'AddToCart',
    {},
    { eventID: 'old-event' }
  );
  expect(fbq).toHaveBeenCalledWith(
    'trackSingle',
    '111',
    'AddToCart',
    {},
    { eventID: 'new-event' }
  );
  active?.();
  current?.();
});

it('discards a prepared event if consent is withdrawn', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    })
  );
  const fbq = vi.fn();
  window.fbq = fbq;
  const release = prepareFacebookPixel('111', 'merchant-a');
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'revoked-event' });
  localStorage.clear();
  release?.();
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    })
  );
  const next = prepareFacebookPixel('111', 'merchant-a');
  const active = activateFacebookPixel('111', 'merchant-a');
  facebookPixelReady();
  expect(fbq).not.toHaveBeenCalledWith(
    'trackSingle',
    '111',
    'AddToCart',
    {},
    { eventID: 'revoked-event' }
  );
  active?.();
  next?.();
});
