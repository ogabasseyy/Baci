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
      <DeferredSocialPixels tiktokPixelId="TT123" />
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
    <DeferredSocialPixels tiktokPixelId="invalid!" snapchatPixelId="invalid" />
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
  const view = render(<DeferredSocialPixels tiktokPixelId="TT123" />);
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
