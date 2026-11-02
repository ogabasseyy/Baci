import { act, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { trackSocialFunnel } from '@/lib/analytics/track-social-funnel';
import { DeferredSocialPixels } from './deferred-social-pixels';

// Hold the provider chunks unresolved while a sibling emits its first event.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

afterEach(() => {
  localStorage.clear();
  delete window.ttq;
});

it('establishes a consented owner before a sibling layout event', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  function EarlyEvent() {
    useLayoutEffect(() => {
      trackSocialFunnel(
        'view_item',
        [{ id: 'one', name: 'Phone', price: 5, quantity: 1 }],
        'NGN',
        'early'
      );
    }, []);
    return null;
  }
  const view = render(
    <>
      <DeferredSocialPixels merchantId="merchant-a" tiktokPixelId="TT123" />
      <EarlyEvent />
    </>
  );
  expect(socialPixelContext.get('tiktok')?.id).toBe('TT123');
  const track = vi.fn();
  window.ttq = {
    track,
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance: () => ({ track, page: vi.fn(), identify: vi.fn() }),
  };
  socialPixelContext.markReady('tiktok', 'TT123');
  window.dispatchEvent(new Event('baci-tiktok-ready'));
  expect(track).toHaveBeenCalledWith(
    'ViewContent',
    expect.objectContaining({ currency: 'NGN' }),
    { event_id: 'early' }
  );
  view.unmount();
  expect(socialPixelContext.get('tiktok')).toBeUndefined();
});

it('does not prepare invalid or unconsented pixel identities', () => {
  const view = render(
    <DeferredSocialPixels
      merchantId="merchant-a"
      tiktokPixelId="invalid!"
      snapchatPixelId="invalid"
    />
  );
  expect(socialPixelContext.get('tiktok')).toBeUndefined();
  expect(socialPixelContext.get('snapchat')).toBeUndefined();
  view.unmount();
});

it('clears the prepared owner immediately when marketing consent is revoked', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  const view = render(
    <DeferredSocialPixels merchantId="merchant-a" tiktokPixelId="TT123" />
  );
  expect(socialPixelContext.get('tiktok')?.id).toBe('TT123');
  act(() => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        functional: true,
        analytics: true,
        marketing: false,
      })
    );
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(socialPixelContext.get('tiktok')).toBeUndefined();
  view.unmount();
});

it('keeps the first consented layout event through server hydration', async () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  const ReactDOMServer = await import('react-dom/server');
  const { hydrateRoot } = await import('react-dom/client');
  function EarlyEvent() {
    useLayoutEffect(() => {
      trackSocialFunnel(
        'view_item',
        [{ id: 'one', name: 'Phone', price: 5, quantity: 1 }],
        'NGN',
        'hydrated-early'
      );
    }, []);
    return null;
  }
  const tree = (
    <>
      <DeferredSocialPixels merchantId="merchant-a" tiktokPixelId="TT123" />
      <EarlyEvent />
    </>
  );
  const container = document.createElement('div');
  container.innerHTML = ReactDOMServer.renderToString(tree);
  document.body.appendChild(container);
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container, tree);
  });
  const track = vi.fn();
  window.ttq = {
    track,
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance: () => ({ track, page: vi.fn(), identify: vi.fn() }),
  };
  socialPixelContext.markReady('tiktok', 'TT123');
  window.dispatchEvent(new Event('baci-tiktok-ready'));
  expect(track).toHaveBeenCalledWith(
    'ViewContent',
    expect.objectContaining({ currency: 'NGN' }),
    { event_id: 'hydrated-early' }
  );
  await act(async () => root?.unmount());
  container.remove();
});

it('discards queued events when merchants share the same configured pixel ID', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  const view = render(
    <DeferredSocialPixels merchantId="merchant-a" tiktokPixelId="TT123" />
  );
  trackSocialFunnel(
    'view_item',
    [{ id: 'one', name: 'Phone', price: 5, quantity: 1 }],
    'NGN',
    'old-tenant'
  );
  view.rerender(
    <DeferredSocialPixels merchantId="merchant-b" tiktokPixelId="TT123" />
  );
  const track = vi.fn();
  window.ttq = {
    track,
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance: () => ({ track, page: vi.fn(), identify: vi.fn() }),
  };
  socialPixelContext.markReady('tiktok', 'TT123');
  window.dispatchEvent(new Event('baci-tiktok-ready'));
  expect(track).not.toHaveBeenCalled();
  view.unmount();
});

it('does not deliver an event queued before consent was revoked and restored', () => {
  const consent = (marketing: boolean) =>
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing,
    });
  localStorage.setItem('baci-cookie-consent', consent(true));
  const view = render(
    <DeferredSocialPixels merchantId="merchant-a" tiktokPixelId="TT123" />
  );
  trackSocialFunnel(
    'view_item',
    [{ id: 'one', name: 'Phone', price: 5, quantity: 1 }],
    'NGN',
    'before-revocation'
  );
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(false));
    window.dispatchEvent(new Event('cookie-consent-updated'));
    localStorage.setItem('baci-cookie-consent', consent(true));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  const track = vi.fn();
  window.ttq = {
    track,
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance: () => ({ track, page: vi.fn(), identify: vi.fn() }),
  };
  socialPixelContext.markReady('tiktok', 'TT123');
  window.dispatchEvent(new Event('baci-tiktok-ready'));
  expect(track).not.toHaveBeenCalled();
  view.unmount();
});

it.each([
  [
    'tiktok',
    'TT123',
    '11111111-1111-4111-8111-111111111111',
    'TT123',
    '22222222-2222-4222-8222-222222222222',
  ],
  [
    'snapchat',
    'TT123',
    '11111111-1111-4111-8111-111111111111',
    'TT456',
    '11111111-1111-4111-8111-111111111111',
  ],
] as const)('keeps the %s owner ready when only the other provider ID changes', (destination, initialTikTok, initialSnapchat, nextTikTok, nextSnapchat) => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  const view = render(
    <DeferredSocialPixels
      merchantId="merchant-a"
      tiktokPixelId={initialTikTok}
      snapchatPixelId={initialSnapchat}
    />
  );
  const id = destination === 'tiktok' ? initialTikTok : initialSnapchat;
  const original = socialPixelContext.get(destination);
  socialPixelContext.markReady(destination, id);
  view.rerender(
    <DeferredSocialPixels
      merchantId="merchant-a"
      tiktokPixelId={nextTikTok}
      snapchatPixelId={nextSnapchat}
    />
  );
  expect(socialPixelContext.get(destination)).toBe(original);
  expect(socialPixelContext.get(destination)?.ready).toBe(true);
  view.unmount();
});
