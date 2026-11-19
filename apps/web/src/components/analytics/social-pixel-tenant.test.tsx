import { act, render } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { analytics } from '@/lib/analytics';
import type { Product } from '@/lib/products';
import { SnapchatPixel } from './snapchat-pixel';
import { TikTokPixel } from './tiktok-pixel';

vi.mock('next/script', () => ({
  default: ({
    onReady,
    children,
    id,
  }: {
    onReady?: () => void;
    children?: ReactNode;
    id?: string;
  }) => {
    useEffect(() => {
      onReady?.();
    }, [onReady]);
    return <script id={id}>{children}</script>;
  },
}));
const product = { id: 'phone', name: 'Phone', price: 200 } as Product;
afterEach(() => {
  localStorage.clear();
  delete window.ttq;
  delete window.snaptr;
});
it('sends only to the active merchant pixels instead of broadcasting to SDK globals left from another merchant', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const instanceTrack = vi.fn();
  const revokeConsent = vi.fn();
  const instance = vi.fn(() => ({
    track: instanceTrack,
    page: vi.fn(),
    identify: vi.fn(),
    revokeConsent,
  }));
  const globalTrack = vi.fn();
  window.ttq = {
    track: globalTrack,
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance,
  };
  window.snaptr = vi.fn();
  const view = render(
    <>
      <TikTokPixel pixelId="TTFIRST123" />
      <SnapchatPixel pixelId="11111111-1111-4111-8111-111111111111" />
    </>
  );
  analytics.viewItem(product, 'NGN', 'event-one');
  expect(instance).toHaveBeenCalledWith('TTFIRST123');
  expect(globalTrack).not.toHaveBeenCalled();
  expect(window.snaptr).toHaveBeenCalledWith(
    'track',
    '11111111-1111-4111-8111-111111111111',
    'VIEW_CONTENT',
    expect.objectContaining({ client_dedup_id: 'event-one' })
  );
  view.rerender(
    <>
      <TikTokPixel pixelId="TTSECOND123" />
      <SnapchatPixel pixelId="22222222-2222-4222-8222-222222222222" />
    </>
  );
  instance.mockClear();
  vi.mocked(window.snaptr).mockClear();
  analytics.viewItem(product, 'NGN', 'event-two');
  expect(instance).toHaveBeenCalledWith('TTSECOND123');
  expect(instance).not.toHaveBeenCalledWith('TTFIRST123');
  view.unmount();
  expect(revokeConsent).toHaveBeenCalled();
  expect(window.snaptr).toHaveBeenCalledWith(
    'track',
    '22222222-2222-4222-8222-222222222222',
    'VIEW_CONTENT',
    expect.objectContaining({ client_dedup_id: 'event-two' })
  );
});

it('regrants SDK consent when a cached script remounts after the visitor opts in again', () => {
  const consent = (marketing: boolean) =>
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing,
        functional: true,
      })
    );
  consent(true);
  const grantConsent = vi.fn();
  const revokeConsent = vi.fn();
  window.ttq = {
    track: vi.fn(),
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance: () => ({
      track: vi.fn(),
      page: vi.fn(),
      identify: vi.fn(),
      grantConsent,
      revokeConsent,
    }),
  };
  render(<TikTokPixel pixelId="TTCACHED123" />);
  act(() => {
    consent(false);
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(revokeConsent).toHaveBeenCalled();
  grantConsent.mockClear();
  act(() => {
    consent(true);
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(grantConsent).toHaveBeenCalledOnce();
});

it.each([
  "pixel');window.injected=true;//",
  '</script><script>injected</script>',
])('does not render or activate provider scripts for an invalid Pixel ID: %s', (pixelId) => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const view = render(
    <>
      <TikTokPixel pixelId={pixelId} />
      <SnapchatPixel pixelId={pixelId} />
    </>
  );
  expect(view.container.querySelector('script')).toBeNull();
});
