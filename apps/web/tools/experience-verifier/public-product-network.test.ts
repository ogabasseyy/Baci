import { expect, it, vi } from 'vitest';
import { HYDRATION_SELECT } from '@/hooks/cart/shared-cart-products';
import { createPublicProductNetwork } from './public-product-network';

const settings = {
  origin: 'https://project.supabase.co',
  merchantId: '11111111-1111-4111-8111-111111111111',
  productId: '33333333-3333-4333-8333-333333333333',
  publishableKey: 'sb_publishable_synthetic123',
};
const url = new URL(`${settings.origin}/rest/v1/products`);
url.searchParams.set('select', HYDRATION_SELECT.replace(/\s+/g, ''));
url.searchParams.set('merchant_id', `eq.${settings.merchantId}`);
url.searchParams.set('id', `in.(${settings.productId})`);
url.searchParams.set('status', 'eq.active');

it('uses only the host-owned public key with a pinned public address', async () => {
  const dial = vi.fn(async () => ({
    response: new Response('[]'),
    close: async () => {},
  }));
  const read = createPublicProductNetwork({
    ...settings,
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    dial,
  });
  await expect(read({ url: url.href, method: 'GET' })).resolves.toEqual({
    status: 200,
    body: '[]',
  });
  expect(dial).toHaveBeenCalledWith(
    url,
    { address: '8.8.8.8', family: 4 },
    settings.publishableKey
  );
});

it('rejects secret keys, other products, private addresses and redirects', async () => {
  expect(() =>
    createPublicProductNetwork({
      ...settings,
      publishableKey: 'sb_secret_do-not-use',
    })
  ).toThrow();
  const dial = vi.fn(async () => ({
    response: new Response('', { status: 302 }),
    close: async () => {},
  }));
  const privateDns = createPublicProductNetwork({
    ...settings,
    resolve: async () => [{ address: '10.0.0.1', family: 4 }],
    dial,
  });
  await expect(privateDns({ url: url.href, method: 'GET' })).rejects.toThrow();
  expect(dial).not.toHaveBeenCalled();
  const read = createPublicProductNetwork({
    ...settings,
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    dial,
  });
  await expect(
    read({ url: `${settings.origin}/rest/v1/orders`, method: 'GET' })
  ).rejects.toThrow();
  await expect(read({ url: url.href, method: 'GET' })).rejects.toThrow();
});

it('rejects a response that does not match the bound merchant and product', async () => {
  const read = createPublicProductNetwork({
    ...settings,
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    dial: async () => ({
      response: new Response(
        JSON.stringify([
          { id: settings.productId, merchant_id: 'foreign', status: 'active' },
        ])
      ),
      close: async () => {},
    }),
  });
  await expect(read({ url: url.href, method: 'GET' })).rejects.toThrow(
    'PUBLIC_PRODUCT_FETCH_FAILED'
  );
});
