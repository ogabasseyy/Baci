import { render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { useLayoutEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { trackSocialFunnel } from '@/lib/analytics/track-social-funnel';
import { DeferredSocialPixels } from './deferred-social-pixels';

// Load the real wrapper asynchronously, while keeping provider scripts inert.
vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return {
    default: (
      loader: () => Promise<ComponentType<Record<string, unknown>>>
    ) => {
      const Component = React.lazy(() =>
        loader().then((component) => ({ default: component }))
      );
      return (props: Record<string, unknown>) => (
        <React.Suspense fallback={null}>
          <Component {...props} />
        </React.Suspense>
      );
    },
  };
});
vi.mock('next/script', async () => {
  const React = await import('react');
  return {
    default: ({ onReady }: { onReady?: () => void }) => {
      React.useEffect(() => {
        onReady?.();
      }, [onReady]);
      return null;
    },
  };
});
afterEach(() => {
  localStorage.clear();
  delete window.ttq;
  delete window.snaptr;
});

it('delivers an early consented event after the real deferred social wrappers become ready', async () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  const track = vi.fn();
  window.ttq = {
    track,
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance: () => ({
      track,
      page: vi.fn(),
      identify: vi.fn(),
      grantConsent: vi.fn(),
      revokeConsent: vi.fn(),
    }),
  };
  const snap = vi.fn();
  window.snaptr = snap;
  function EarlyEvent() {
    useLayoutEffect(() => {
      trackSocialFunnel(
        'view_item',
        [{ id: 'one', name: 'Phone', price: 5, quantity: 1 }],
        'NGN',
        'real-deferred'
      );
    }, []);
    return null;
  }
  const view = render(
    <>
      <DeferredSocialPixels
        merchantId="merchant-a"
        tiktokPixelId="TT123"
        snapchatPixelId="11111111-1111-4111-8111-111111111111"
      />
      <EarlyEvent />
    </>
  );
  await waitFor(() =>
    expect(track).toHaveBeenCalledWith(
      'ViewContent',
      expect.objectContaining({ currency: 'NGN' }),
      { event_id: 'real-deferred' }
    )
  );
  await waitFor(() =>
    expect(snap).toHaveBeenCalledWith(
      'track',
      '11111111-1111-4111-8111-111111111111',
      'VIEW_CONTENT',
      expect.objectContaining({ client_dedup_id: 'real-deferred' })
    )
  );
  view.unmount();
});
