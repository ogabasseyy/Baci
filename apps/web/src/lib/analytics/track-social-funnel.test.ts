import { afterEach, expect, it, vi } from 'vitest';
import { snapchatEvents } from '@/components/analytics/snapchat-pixel';
import { tiktokEvents } from '@/components/analytics/tiktok-pixel';
import { analytics } from '@/lib/analytics';
import { trackEvent } from '@/lib/event-tracking';
import type { Product } from '@/lib/products';
import { socialPixelContext } from './social-pixel-context';

const product = { id: 'product-one', name: 'Phone', price: 200 } as Product;
afterEach(() => {
  localStorage.clear();
  delete window.ttq;
  delete window.snaptr;
  vi.unstubAllGlobals();
});
function pixels(activate = true) {
  if (activate) socialPixelContext.activate('tiktok', 'tt-unit');
  socialPixelContext.markReady('tiktok', 'tt-unit');
  if (activate) socialPixelContext.activate('snapchat', 'snap-unit');
  socialPixelContext.markReady('snapchat', 'snap-unit');
  const track = vi.fn();
  window.ttq = {
    track,
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance: vi.fn(),
  };
  window.ttq.instance = () => ({
    track,
    page: () => {},
    identify: () => {},
  });
  window.snaptr = vi.fn();
  return { tt: vi.mocked(window.ttq.track), snap: vi.mocked(window.snaptr) };
}
it('does not leak events from loaded SDK globals after marketing consent is revoked', () => {
  const { tt, snap } = pixels();
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ necessary: true, analytics: true, marketing: false })
  );
  tiktokEvents.addToCart('one', 'Phone', 200, 2, 'NGN');
  snapchatEvents.addToCart('one', 200, 'NGN');
  expect(tt).not.toHaveBeenCalled();
  expect(snap).not.toHaveBeenCalled();
});
it('wires actual storefront funnel calls with one shared ID and merchant currency', () => {
  const { tt, snap } = pixels();
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  trackEvent.addToCart(
    '11111111-1111-4111-8111-111111111111',
    product,
    2,
    'NGN'
  );
  const input = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(input.marketing_consent).toBe(true);
  expect(input.event_id).toEqual(expect.any(String));
  expect(tt).toHaveBeenCalledWith(
    'AddToCart',
    expect.objectContaining({ currency: 'NGN', value: 400 }),
    { event_id: input.event_id }
  );
  expect(snap).toHaveBeenCalledWith(
    'track',
    'snap-unit',
    'ADD_CART',
    expect.objectContaining({
      currency: 'NGN',
      price: 400,
      client_dedup_id: input.event_id,
    })
  );
});
it('keeps internal telemetry but disables social destinations when marketing is denied', () => {
  pixels();
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ necessary: true, analytics: true, marketing: false })
  );
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  trackEvent.productView(
    '11111111-1111-4111-8111-111111111111',
    product,
    'NGN'
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    event_type: 'product_view',
    marketing_consent: false,
  });
  expect(window.ttq?.track).not.toHaveBeenCalled();
  expect(window.snaptr).not.toHaveBeenCalled();
});
it('allows social tracking independently of analytics consent when marketing is granted', () => {
  const { tt, snap } = pixels();
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: false,
      marketing: true,
      functional: true,
    })
  );
  analytics.viewItem(product, 'NGN');
  expect(tt).toHaveBeenCalled();
  expect(snap).toHaveBeenCalled();
});

it('holds the first product event until the normal pixel bootstrap is ready', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  socialPixelContext.activate('tiktok', 'tt-unit');
  socialPixelContext.activate('snapchat', 'snap-unit');
  analytics.viewItem(product, 'NGN', 'pending-first-view');
  const { tt, snap } = pixels(false);
  window.dispatchEvent(new Event('baci-tiktok-ready'));
  window.dispatchEvent(new Event('baci-snapchat-ready'));
  expect(tt).toHaveBeenCalledWith(
    'ViewContent',
    expect.objectContaining({ currency: 'NGN' }),
    { event_id: 'pending-first-view' }
  );
  expect(snap).toHaveBeenCalledWith(
    'track',
    'snap-unit',
    'VIEW_CONTENT',
    expect.objectContaining({ client_dedup_id: 'pending-first-view' })
  );
});

it('drops pending events from an unmounted or revoked pixel activation even when the same Pixel ID is mounted again', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    })
  );
  socialPixelContext.activate('tiktok', 'tt-unit');
  socialPixelContext.activate('snapchat', 'snap-unit');
  analytics.viewItem(product, 'NGN', 'revoked-before-ready');
  const { tt, snap } = pixels();
  window.dispatchEvent(new Event('baci-tiktok-ready'));
  window.dispatchEvent(new Event('baci-snapchat-ready'));
  expect(tt).not.toHaveBeenCalled();
  expect(snap).not.toHaveBeenCalled();
});
