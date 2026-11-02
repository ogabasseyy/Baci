import { act, render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { useLayoutEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { trackSocialFunnel } from '@/lib/analytics/track-social-funnel';
import { DeferredSocialPixels } from './deferred-social-pixels';

const delayed = vi.hoisted(() => {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release(), scripts: vi.fn() };
});
vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return {
    default: (
      loader: () => Promise<ComponentType<Record<string, unknown>>>
    ) => {
      const Component = React.lazy(() =>
        delayed.promise
          .then(loader)
          .then((component) => ({ default: component }))
      );
      return (props: Record<string, unknown>) => (
        <React.Suspense fallback={null}>
          <Component {...props} />
        </React.Suspense>
      );
    },
  };
});
vi.mock('next/script', () => ({
  default: () => {
    delayed.scripts();
    return null;
  },
}));
afterEach(() => {
  localStorage.clear();
  delete window.ttq;
});

it('does not mount a delayed provider or deliver its queued event after consent is revoked', async () => {
  const consent = (marketing: boolean) =>
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing,
    });
  localStorage.setItem('baci-cookie-consent', consent(true));
  const track = vi.fn();
  window.ttq = {
    track,
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance: () => ({ track, page: vi.fn(), identify: vi.fn() }),
  };
  function EarlyEvent() {
    useLayoutEffect(() => {
      trackSocialFunnel(
        'view_item',
        [{ id: 'one', name: 'Phone', price: 5, quantity: 1 }],
        'NGN',
        'revoked-while-loading'
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
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(false));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(socialPixelContext.get('tiktok')).toBeUndefined();
  await act(async () => {
    delayed.release();
    await delayed.promise;
    await import('./tiktok-pixel');
  });
  await waitFor(() => expect(delayed.scripts).not.toHaveBeenCalled());
  window.dispatchEvent(new Event('baci-tiktok-ready'));
  expect(track).not.toHaveBeenCalled();
  view.unmount();
});
