import { act, render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { StrictMode, useLayoutEffect, useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { measureXEvent, resetXPixel } from '@/lib/x-ads/pixel-client';
import { DeferredTwitterPixel } from './deferred-twitter-pixel';

const route = vi.hoisted(() => ({ pathname: '/products/phone' }));
vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return {
    default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) =>
      React.lazy(() => loader().then((component) => ({ default: component }))),
  };
});
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/script', async () => {
  const React = await import('react');
  return {
    default: ({ onReady }: { onReady?: () => void }) => {
      React.useEffect(() => onReady?.(), [onReady]);
      return null;
    },
  };
});
const events = { pageView: 'tw-abc-page', addToCart: 'tw-abc-cart' };
function consent(marketing: boolean) {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing,
    })
  );
}
afterEach(() => {
  resetXPixel();
  localStorage.clear();
  delete window.twq;
  route.pathname = '/products/phone';
});
it('continues to send events and page views after client navigation', async () => {
  window.history.replaceState({}, '', '/products/phone');
  consent(true);
  const twq = vi.fn();
  window.twq = twq;
  const view = render(
    <DeferredTwitterPixel
      merchantId="merchant-a"
      pixelId="abc"
      eventIds={events}
    />
  );
  await waitFor(() => expect(twq).toHaveBeenCalledWith('config', 'abc'));
  twq.mockClear();
  route.pathname = '/products/other';
  window.history.replaceState({}, '', route.pathname);
  view.rerender(
    <DeferredTwitterPixel
      merchantId="merchant-a"
      pixelId="abc"
      eventIds={events}
    />
  );
  await waitFor(() =>
    expect(
      twq.mock.calls.filter(
        ([action, id]) => action === 'event' && id === 'tw-abc-page'
      )
    ).toHaveLength(1)
  );
  measureXEvent('addToCart', { conversion_id: 'after-navigation' });
  expect(twq).toHaveBeenCalledWith('event', 'tw-abc-cart', {
    conversion_id: 'after-navigation',
  });
  view.unmount();
});
it('retains an early event and sends one page view through Strict Mode replay', async () => {
  window.history.replaceState({}, '', '/products/phone');
  consent(true);
  const twq = vi.fn();
  window.twq = twq;
  function EarlyEvent() {
    const sent = useRef(false);
    useLayoutEffect(() => {
      if (!sent.current) {
        sent.current = true;
        measureXEvent('addToCart', { conversion_id: 'early' });
      }
    }, []);
    return null;
  }
  const view = render(
    <StrictMode>
      <DeferredTwitterPixel
        merchantId="merchant-a"
        pixelId="abc"
        eventIds={events}
      />
      <EarlyEvent />
    </StrictMode>
  );
  await waitFor(() =>
    expect(twq).toHaveBeenCalledWith('event', 'tw-abc-cart', {
      conversion_id: 'early',
    })
  );
  expect(
    twq.mock.calls.filter(
      ([action, id]) => action === 'event' && id === 'tw-abc-page'
    )
  ).toHaveLength(1);
  view.unmount();
});
it('does not carry events across a batched consent withdrawal and grant', async () => {
  window.history.replaceState({}, '', '/products/phone');
  consent(true);
  const twq = vi.fn();
  window.twq = twq;
  const view = render(
    <DeferredTwitterPixel
      merchantId="merchant-a"
      pixelId="abc"
      eventIds={events}
    />
  );
  await waitFor(() => expect(twq).toHaveBeenCalledWith('config', 'abc'));
  twq.mockClear();
  act(() => {
    consent(false);
    window.dispatchEvent(new Event('cookie-consent-updated'));
    measureXEvent('addToCart', { conversion_id: 'denied' });
    consent(true);
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  await waitFor(() => {
    measureXEvent('addToCart', { conversion_id: 'allowed' });
    expect(twq).toHaveBeenCalledWith('event', 'tw-abc-cart', {
      conversion_id: 'allowed',
    });
  });
  expect(twq).not.toHaveBeenCalledWith('event', 'tw-abc-cart', {
    conversion_id: 'denied',
  });
  view.unmount();
});
