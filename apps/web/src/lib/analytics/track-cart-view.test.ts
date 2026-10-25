import { afterEach, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { facebookCapiEventSchema } from '@/schemas/facebook-capi-event';
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
    JSON.stringify({ analytics: true })
  );
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  window.fbq = vi.fn();
  trackCartView([{ product, quantity: 1 }], 'NGN', { merchantId });
  const payload = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(facebookCapiEventSchema.safeParse(payload).success).toBe(true);
  expect(payload).toMatchObject({
    merchantId,
    consent: true,
    eventData: { currency: 'NGN' },
  });
  expect(vi.mocked(window.fbq).mock.calls[0][3]).toEqual({
    eventID: payload.eventId,
  });
});
it('leaves server delivery off when there is no merchant context', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: true })
  );
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  trackCartView([], 'NGN');
  expect(fetcher).not.toHaveBeenCalled();
});
