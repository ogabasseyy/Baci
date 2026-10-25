import { afterEach, expect, it, vi } from 'vitest';
import { analytics } from './analytics';

afterEach(() => {
  localStorage.clear();
  delete window.fbq;
});

it('sends parent product IDs as groups without changing the value', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: true })
  );
  window.fbq = vi.fn();
  analytics.viewItem(
    {
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
    },
    'NGN'
  );
  expect(window.fbq).toHaveBeenCalledWith(
    'track',
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
  analytics.viewCart([], 'NGN', { merchantId: 'merchant-1' });
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('shares the browser event ID with the real cart CAPI envelope', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: true })
  );
  window.fbq = vi.fn();
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  analytics.viewCart([], 'NGN', { merchantId: 'merchant-1' });
  const pixelCall = vi.mocked(window.fbq).mock.calls[0];
  const payload = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(pixelCall[3]).toEqual({ eventID: expect.any(String) });
  expect(pixelCall[3]).toEqual({ eventID: payload.eventId });
  expect(payload.consent).toBe(true);
  vi.unstubAllGlobals();
});
