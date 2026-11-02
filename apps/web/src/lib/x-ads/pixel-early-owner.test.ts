import { afterEach, expect, it, vi } from 'vitest';
import {
  initializeXPixel,
  markXPixelReady,
  measureXEvent,
  prepareXPixel,
  resetXPixel,
} from './pixel-client';

afterEach(() => {
  resetXPixel();
  localStorage.clear();
  delete window.twq;
});
const events = { viewContent: 'tw-abc-view', addToCart: 'tw-abc-cart' };
function consent() {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
}
it('retains an early consented event until the prepared merchant pixel loads', () => {
  consent();
  const twq = vi.fn();
  window.twq = twq;
  const release = prepareXPixel('abc', events, 'merchant-a');
  measureXEvent('addToCart', { conversion_id: 'early' });
  const token = initializeXPixel('abc', events, 'merchant-a');
  markXPixelReady(token);
  expect(twq).toHaveBeenCalledWith('event', 'tw-abc-cart', {
    conversion_id: 'early',
  });
  resetXPixel(token);
  release?.();
});
it('does not forward queued events to another merchant sharing the same pixel', () => {
  consent();
  const twq = vi.fn();
  window.twq = twq;
  const old = prepareXPixel('abc', events, 'merchant-a');
  measureXEvent('addToCart', { conversion_id: 'old' });
  const current = prepareXPixel('abc', events, 'merchant-b');
  old?.();
  measureXEvent('addToCart', { conversion_id: 'new' });
  const token = initializeXPixel('abc', events, 'merchant-b');
  markXPixelReady(token);
  expect(twq).not.toHaveBeenCalledWith('event', 'tw-abc-cart', {
    conversion_id: 'old',
  });
  expect(twq).toHaveBeenCalledWith('event', 'tw-abc-cart', {
    conversion_id: 'new',
  });
  resetXPixel(token);
  current?.();
});
it('does not let a stale invalid activation clear a newer prepared owner', () => {
  consent();
  const twq = vi.fn();
  window.twq = twq;
  const release = prepareXPixel('abc', events, 'merchant-b');
  measureXEvent('addToCart', { conversion_id: 'new' });
  initializeXPixel('invalid-id', events, 'merchant-b');
  const token = initializeXPixel('abc', events, 'merchant-b');
  markXPixelReady(token);
  expect(twq).toHaveBeenCalledWith('event', 'tw-abc-cart', {
    conversion_id: 'new',
  });
  release?.();
});
it('retains an early conversion after navigation within the same prepared owner', () => {
  window.history.replaceState({}, '', '/products/phone');
  consent();
  const twq = vi.fn();
  window.twq = twq;
  const release = prepareXPixel('abc', events, 'merchant-a');
  measureXEvent('addToCart', { conversion_id: 'before-navigation' });
  window.history.replaceState({}, '', '/cart');
  const token = initializeXPixel('abc', events, 'merchant-a');
  markXPixelReady(token);
  expect(twq).toHaveBeenCalledWith('event', 'tw-abc-cart', {
    conversion_id: 'before-navigation',
  });
  release?.();
});
it('does not activate an old configuration after the event mapping changes', () => {
  consent();
  const twq = vi.fn();
  window.twq = twq;
  const newEvents = { addToCart: 'tw-abc-new' };
  const release = prepareXPixel('abc', newEvents, 'merchant-a');
  measureXEvent('addToCart', { conversion_id: 'new' });
  const stale = initializeXPixel('abc', events, 'merchant-a');
  markXPixelReady(stale);
  expect(twq).not.toHaveBeenCalled();
  const token = initializeXPixel('abc', newEvents, 'merchant-a');
  markXPixelReady(token);
  expect(twq).toHaveBeenCalledWith('event', 'tw-abc-new', {
    conversion_id: 'new',
  });
  release?.();
});
it('keeps queued events during effect cleanup but discards them on owner release', () => {
  consent();
  const twq = vi.fn();
  window.twq = twq;
  const release = prepareXPixel('abc', events, 'merchant-a');
  const first = initializeXPixel('abc', events, 'merchant-a');
  measureXEvent('addToCart', { conversion_id: 'pending' });
  resetXPixel(first);
  markXPixelReady(first);
  expect(twq).not.toHaveBeenCalled();
  const second = initializeXPixel('abc', events, 'merchant-a');
  markXPixelReady(second);
  expect(twq).toHaveBeenCalledWith('event', 'tw-abc-cart', {
    conversion_id: 'pending',
  });
  release?.();
  measureXEvent('addToCart', { conversion_id: 'after-release' });
  expect(twq).not.toHaveBeenCalledWith('event', 'tw-abc-cart', {
    conversion_id: 'after-release',
  });
});
