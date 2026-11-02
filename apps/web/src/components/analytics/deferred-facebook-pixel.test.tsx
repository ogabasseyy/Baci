import { act, render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { StrictMode, useLayoutEffect, useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { sendFacebookPixelEvent } from '@/lib/analytics/facebook-pixel-client';
import { DeferredFacebookPixel } from './deferred-facebook-pixel';

vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return {
    default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) =>
      React.lazy(() => loader().then((component) => ({ default: component }))),
  };
});
vi.mock('next/navigation', () => ({ usePathname: () => '/products/phone' }));
vi.mock('next/script', async () => {
  const React = await import('react');
  return {
    default: ({ onReady }: { onReady?: () => void }) => {
      React.useEffect(() => onReady?.(), [onReady]);
      return null;
    },
  };
});
afterEach(() => {
  localStorage.clear();
  delete window.fbq;
});
it('retains an early consented event until the deferred Facebook wrapper is ready', async () => {
  window.history.replaceState({}, '', '/products/phone');
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
  function EarlyEvent() {
    useLayoutEffect(() => {
      sendFacebookPixelEvent(
        'AddToCart',
        { currency: 'NGN' },
        { eventID: 'early-facebook' }
      );
    }, []);
    return null;
  }
  const view = render(
    <>
      <DeferredFacebookPixel merchantId="merchant-a" pixelId="111" />
      <EarlyEvent />
    </>
  );
  await waitFor(() =>
    expect(fbq).toHaveBeenCalledWith(
      'trackSingle',
      '111',
      'AddToCart',
      { currency: 'NGN' },
      { eventID: 'early-facebook' }
    )
  );
  view.unmount();
});

it('revokes and reactivates after consent changes in one batch', async () => {
  window.history.replaceState({}, '', '/products/phone');
  const consent = (analytics: boolean) =>
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics,
      marketing: false,
    });
  localStorage.setItem('baci-cookie-consent', consent(true));
  const fbq = vi.fn();
  window.fbq = fbq;
  const view = render(
    <DeferredFacebookPixel merchantId="merchant-a" pixelId="111" />
  );
  await waitFor(() => expect(fbq).toHaveBeenCalledWith('consent', 'grant'));
  fbq.mockClear();
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(false));
    window.dispatchEvent(new Event('cookie-consent-updated'));
    localStorage.setItem('baci-cookie-consent', consent(true));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  await waitFor(() => expect(fbq).toHaveBeenCalledWith('consent', 'grant'));
  expect(fbq).toHaveBeenCalledWith('consent', 'revoke');
  fbq.mockClear();
  sendFacebookPixelEvent('AddToCart', {}, { eventID: 'after-restore' });
  expect(fbq).toHaveBeenCalledWith(
    'trackSingle',
    '111',
    'AddToCart',
    {},
    { eventID: 'after-restore' }
  );
  view.unmount();
});

it('revokes synchronously on consent withdrawal after Strict Mode effect replay', async () => {
  window.history.replaceState({}, '', '/products/phone');
  const consent = (analytics: boolean) =>
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics,
      marketing: false,
    });
  localStorage.setItem('baci-cookie-consent', consent(true));
  const fbq = vi.fn();
  window.fbq = fbq;
  const view = render(
    <StrictMode>
      <DeferredFacebookPixel merchantId="merchant-a" pixelId="111" />
    </StrictMode>
  );
  await waitFor(() => expect(fbq).toHaveBeenCalledWith('consent', 'grant'));
  fbq.mockClear();
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(false));
    window.dispatchEvent(new Event('cookie-consent-updated'));
    expect(fbq).toHaveBeenCalledWith('consent', 'revoke');
  });
  view.unmount();
});

it('retains an early event through Strict Mode effect replay', async () => {
  window.history.replaceState({}, '', '/products/phone');
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
  function EarlyEvent() {
    const sent = useRef(false);
    useLayoutEffect(() => {
      if (!sent.current) {
        sent.current = true;
        sendFacebookPixelEvent('AddToCart', {}, { eventID: 'strict-early' });
      }
    }, []);
    return null;
  }
  const view = render(
    <StrictMode>
      <DeferredFacebookPixel merchantId="merchant-a" pixelId="111" />
      <EarlyEvent />
    </StrictMode>
  );
  await waitFor(() =>
    expect(fbq).toHaveBeenCalledWith(
      'trackSingle',
      '111',
      'AddToCart',
      {},
      { eventID: 'strict-early' }
    )
  );
  expect(
    fbq.mock.calls.filter(
      ([action, id, event]) =>
        action === 'trackSingle' && id === '111' && event === 'PageView'
    )
  ).toHaveLength(1);
  view.unmount();
});
