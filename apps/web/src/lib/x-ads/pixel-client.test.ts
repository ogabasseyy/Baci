import { afterEach, expect, it, vi } from 'vitest';
import { initializeXPixel, measureXEvent, resetXPixel } from './pixel-client';

const events = { viewContent: 'tw-abc-view', addToCart: 'tw-abc-cart' };
afterEach(() => {
  resetXPixel();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it('does not dispatch through a retained SDK after marketing consent is withdrawn', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const twq = vi.fn();
  window.twq = twq;
  initializeXPixel('abc', events);
  measureXEvent('addToCart', {
    conversion_id: 'same-event',
    currency: 'NGN',
    value: 500,
  });
  expect(twq).toHaveBeenCalledWith(
    'event',
    'tw-abc-cart',
    expect.objectContaining({
      conversion_id: 'same-event',
      currency: 'NGN',
      value: 500,
    })
  );
  twq.mockClear();
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: true,
    })
  );
  measureXEvent('addToCart', { conversion_id: 'later' });
  expect(twq).not.toHaveBeenCalled();
});
it('does not send an event configured for another merchant pixel', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const twq = vi.fn();
  window.twq = twq;
  initializeXPixel('abc', { addToCart: 'tw-other-cart' });
  measureXEvent('addToCart', {});
  expect(twq).not.toHaveBeenCalledWith(
    'event',
    expect.anything(),
    expect.anything()
  );
});
it('replaces the previous merchant event map instead of leaking it to a new store', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const twq = vi.fn();
  window.twq = twq;
  initializeXPixel('abc', events);
  initializeXPixel('new', { viewContent: 'tw-new-view' });
  twq.mockClear();
  measureXEvent('addToCart', {});
  expect(twq).not.toHaveBeenCalled();
  measureXEvent('viewContent', {});
  expect(twq).toHaveBeenCalledWith('event', 'tw-new-view', {});
});
it('does not issue a browser purchase from an untrusted funnel helper', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const twq = vi.fn();
  window.twq = twq;
  initializeXPixel('abc', { purchase: 'tw-abc-paid' });
  twq.mockClear();
  measureXEvent('purchase', {});
  expect(twq).not.toHaveBeenCalled();
});
it('hands queued bootstrap calls to the loaded SDK instead of buffering forever', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  delete window.twq;
  initializeXPixel('abc', events);
  const sdk = vi.fn();
  const queue = window.twq as unknown as NonNullable<Window['twq']> & {
    exe?: (...args: unknown[]) => void;
  };
  queue.exe = sdk;
  measureXEvent('viewContent', { conversion_id: 'after-sdk' });
  expect(sdk).toHaveBeenCalledWith('event', 'tw-abc-view', {
    conversion_id: 'after-sdk',
  });
});
it('clears prior merchant configuration when the next Pixel ID is invalid', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const sdk = vi.fn();
  window.twq = sdk;
  initializeXPixel('abc', events);
  initializeXPixel('invalid/pixel', {});
  sdk.mockClear();
  measureXEvent('viewContent', {});
  expect(sdk).not.toHaveBeenCalled();
});
it('configures a Pixel only once for the same loaded SDK queue', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const sdk = vi.fn();
  window.twq = sdk;
  initializeXPixel('abc', events);
  initializeXPixel('abc', events);
  expect(sdk.mock.calls.filter(([action]) => action === 'config')).toHaveLength(
    1
  );
});
