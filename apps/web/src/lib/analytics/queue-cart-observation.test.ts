import { afterEach, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { queueCartObservation } from './queue-cart-observation';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('does not transmit any cart data without an explicit consent purpose', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await queueCartObservation([], 'NGN', 'event', 'merchant');
  expect(fetcher).not.toHaveBeenCalled();
});
it('preserves one identity and allowed targets while surfacing enqueue rejection', async () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: true,
      functional: false,
    })
  );
  const fetcher = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal('fetch', fetcher);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await queueCartObservation(
    [
      {
        product: { id: 'phone', name: 'Phone', price: 300 } as Product,
        quantity: 2,
      },
    ],
    'NGN',
    'one-event',
    'one-merchant'
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    event_id: 'one-event',
    merchant_id: 'one-merchant',
    targets: ['facebook', 'tiktok', 'snapchat'],
    custom_data: { value: 600, currency: 'NGN' },
  });
  expect(warn).toHaveBeenCalledWith('Cart observation was not accepted');
});
it('handles a network failure without blocking the cart', async () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(
    queueCartObservation([], 'NGN', 'event', 'merchant')
  ).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith('Cart observation could not be queued');
});
