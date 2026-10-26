import { afterEach, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { analytics } from './analytics';
import { activateFacebookPixel } from './analytics/facebook-pixel-client';

const phoneProduct: Product = {
  id: 'phone',
  name: 'Phone',
  price: 891000,
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

afterEach(() => {
  localStorage.clear();
  delete window.fbq;
});

it('sends parent product IDs as groups without changing the value', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  window.fbq = vi.fn();
  activateFacebookPixel('123');
  vi.mocked(window.fbq as NonNullable<typeof window.fbq>).mockClear();
  analytics.viewItem(phoneProduct, 'NGN');
  expect(window.fbq).toHaveBeenCalledWith(
    'trackSingle',
    '123',
    'ViewContent',
    expect.objectContaining({
      content_ids: ['phone'],
      content_type: 'product_group',
      value: 891000,
    })
  );
});

it('keeps the consent gate for catalog matching events', () => {
  window.fbq = vi.fn();
  analytics.pageView('/');
  expect(window.fbq).not.toHaveBeenCalled();
});

it('does not dispatch cart CAPI without consent', () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  activateFacebookPixel('123');
  vi.mocked(window.fbq ?? vi.fn()).mockClear();
  analytics.viewCart([{ product: phoneProduct, quantity: 1 }], 'NGN', {
    merchantId: 'merchant-1',
  });
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('shares the browser event ID with the real cart CAPI envelope', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  window.fbq = vi.fn();
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  activateFacebookPixel('123');
  vi.mocked(window.fbq ?? vi.fn()).mockClear();
  analytics.viewCart([{ product: phoneProduct, quantity: 1 }], 'NGN', {
    merchantId: 'merchant-1',
  });
  const pixelCall = vi.mocked(window.fbq).mock.calls[0];
  const payload = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(pixelCall[4]).toEqual({ eventID: expect.any(String) });
  expect(pixelCall[4]).toEqual({ eventID: payload.eventId });
  expect(payload.consent).toBe(true);
  vi.unstubAllGlobals();
});
