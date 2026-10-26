import { afterEach, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { facebookCapiEventSchema } from '@/schemas/facebook-capi-event';
import { activateFacebookPixel } from './facebook-pixel-client';
import { trackCartView } from './track-cart-view';

const product: Product = {
  id: 'phone',
  name: 'Phone',
  price: 200,
  description: '',
  status: 'active',
  manage_stock: false,
  stock: 0,
  image: '',
  imageLarge: '',
  imageHint: '',
  brand: 'Apple',
  gtin: '',
  mpn: '',
};
const merchantId = '22222222-2222-4222-8222-222222222222';
afterEach(() => {
  localStorage.clear();
  delete window.fbq;
  vi.unstubAllGlobals();
});
it('does not queue or send a cart observation without consent', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  window.fbq = vi.fn();
  trackCartView([], 'NGN', { merchantId: 'merchant-1' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(window.fbq).not.toHaveBeenCalled();
});
it('shares an event ID and preserves the tenant and currency in the browser/server pair', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  window.fbq = vi.fn();
  activateFacebookPixel('123');
  vi.mocked(window.fbq as NonNullable<typeof window.fbq>).mockClear();
  trackCartView([{ product, quantity: 1 }], 'NGN', { merchantId });
  const payload = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(facebookCapiEventSchema.safeParse(payload).success).toBe(true);
  expect(payload).toMatchObject({
    merchantId,
    consent: true,
    eventData: { currency: 'NGN' },
  });
  expect(vi.mocked(window.fbq).mock.calls[0][4]).toEqual({
    eventID: payload.eventId,
  });
});
it('leaves server delivery off when there is no merchant context', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  trackCartView([], 'NGN');
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not create a rejected empty-cart observation', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  window.fbq = vi.fn();
  trackCartView([], 'NGN', { merchantId });
  expect(fetcher).not.toHaveBeenCalled();
  expect(window.fbq).not.toHaveBeenCalled();
});

it('queues a marketing-consented cart view for both social destinations without requiring analytics consent', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: false,
      marketing: true,
      functional: true,
    })
  );
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  trackCartView([{ product, quantity: 2 }], 'NGN', { merchantId });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const payloads = fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
  expect(new Set(payloads.map((p) => p.eventId)).size).toBe(1);
  expect(payloads[0]).toMatchObject({
    event: 'view_item',
    consent: true,
    merchantId,
    eventData: { currency: 'NGN', value: 400 },
  });
});
