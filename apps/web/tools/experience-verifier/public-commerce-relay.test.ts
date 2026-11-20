import { expect, it, vi } from 'vitest';
import { HYDRATION_SELECT } from '@/hooks/cart/shared-cart-products';
import { createPublicCommerceRelay } from './public-commerce-relay';

it('routes only the exact bound product read to the anonymous reader', async () => {
  const product = {
    origin: 'https://project.supabase.co',
    merchantId: '11111111-1111-4111-8111-111111111111',
    productId: '33333333-3333-4333-8333-333333333333',
  };
  const url = new URL(`${product.origin}/rest/v1/products`);
  url.searchParams.set('select', HYDRATION_SELECT.replace(/\s+/g, ''));
  url.searchParams.set('merchant_id', `eq.${product.merchantId}`);
  url.searchParams.set('id', `in.(${product.productId})`);
  url.searchParams.set('status', 'eq.active');
  const readProduct = vi.fn(async () => ({ status: 200, body: '[]' }));
  const cart = vi.fn(async () => {
    throw Error('denied');
  });
  const relay = createPublicCommerceRelay({ product, readProduct, cart });
  await expect(relay({ url: url.href, method: 'GET' })).resolves.toEqual({
    status: 200,
    body: '[]',
  });
  await expect(
    relay({ url: url.href, method: 'GET', body: '{}' })
  ).rejects.toThrow();
  await expect(
    relay({ url: url.href.replace('/products?', '/orders?'), method: 'GET' })
  ).rejects.toThrow();
  expect(readProduct).toHaveBeenCalledTimes(1);
});
