import { afterEach, expect, it, vi } from 'vitest';
import { analytics } from '@/lib/analytics';
import type { Product } from '@/lib/products';
import { initializeXPixel, markXPixelReady, resetXPixel } from './pixel-client';

const product = { id: 'catalog-one', name: 'Phone', price: 500 } as Product;
afterEach(() => {
  localStorage.clear();
  resetXPixel();
  delete window.twq;
});
it('dispatches actual product, cart and checkout calls to the configured merchant X events with storefront currency', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: false,
      marketing: true,
      functional: false,
    })
  );
  const twq = vi.fn();
  window.twq = twq;
  const activation = initializeXPixel('abc', {
    viewContent: 'tw-abc-view',
    addToCart: 'tw-abc-cart',
    initiateCheckout: 'tw-abc-checkout',
  });
  markXPixelReady(activation);
  twq.mockClear();
  analytics.viewItem(product, 'NGN');
  analytics.addToCart(product, 2, 'NGN');
  analytics.beginCheckout([{ product, quantity: 2 }], 'NGN');
  expect(twq).toHaveBeenCalledWith(
    'event',
    'tw-abc-view',
    expect.objectContaining({
      currency: 'NGN',
      value: 500,
      contents: [expect.objectContaining({ content_id: 'catalog-one' })],
    })
  );
  expect(twq).toHaveBeenCalledWith(
    'event',
    'tw-abc-cart',
    expect.objectContaining({ currency: 'NGN', value: 1000 })
  );
  expect(twq).toHaveBeenCalledWith(
    'event',
    'tw-abc-checkout',
    expect.objectContaining({ currency: 'NGN', value: 1000 })
  );
});
