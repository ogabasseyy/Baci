import { expect, it, vi } from 'vitest';
import { createPublicCartNetwork } from './public-cart-network';
import { createPublicCartSession } from './public-cart-session';

const origin = 'https://shop.example.com';
const merchantSlug = 'synthetic';
const productId = '10000000-0000-4000-8000-000000000001';
const good = {
  url: `${origin}/api/storefront/cart`,
  method: 'GET',
  headers: { accept: 'application/json' },
};
const publicDns = async () => [{ address: '8.8.8.8', family: 4 }];

it('pins an independently resolved public address and retains only bounded cookie headers', async () => {
  const dial = vi.fn(async () => ({
    response: new Response('{"cart":{}}', {
      headers: { 'set-cookie': 'a=b; Path=/; Secure' },
    }),
    close: async () => {},
  }));
  const network = createPublicCartNetwork({
    origin,
    merchantSlug,
    productId,
    resolve: publicDns,
    dial,
  });
  expect(await network(good)).toMatchObject({
    status: 200,
    cookies: ['a=b; Path=/; Secure'],
  });
  expect(dial).toHaveBeenCalledWith(
    expect.objectContaining({ url: good.url }),
    { address: '8.8.8.8', family: 4 }
  );
});

it('rejects private DNS, forbidden routes, unapproved headers and redirects', async () => {
  const dial = vi.fn(async () => ({
    response: new Response('', { status: 302 }),
    close: async () => {},
  }));
  const blocked = createPublicCartNetwork({
    origin,
    merchantSlug,
    productId,
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    dial,
  });
  await expect(blocked(good)).rejects.toThrow();
  expect(dial).not.toHaveBeenCalled();
  const network = createPublicCartNetwork({
    origin,
    merchantSlug,
    productId,
    resolve: publicDns,
    dial,
  });
  await expect(
    network({ ...good, url: `${origin}/api/orders` })
  ).rejects.toThrow();
  await expect(
    network({ ...good, headers: { authorization: 'Bearer secret' } })
  ).rejects.toThrow();
  expect(dial).not.toHaveBeenCalled();
  await expect(network(good)).rejects.toThrow();
});

it('aborts oversized streams and closes the dispatcher', async () => {
  const cancel = vi.fn();
  const close = vi.fn(async () => {});
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1048577));
    },
    cancel,
  });
  const network = createPublicCartNetwork({
    origin,
    merchantSlug,
    productId,
    resolve: publicDns,
    dial: async () => ({ response: new Response(stream), close }),
  });
  await expect(network(good)).rejects.toThrow();
  expect(cancel).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});

it('composes the session and pinned network without exposing its session cookie', async () => {
  const merchantId = '30000000-0000-4000-8000-000000000003';
  const token = 'x'.repeat(43);
  const dial = vi
    .fn()
    .mockResolvedValueOnce({
      response: new Response('{}', {
        headers: { 'set-cookie': `__Host-csrf-token=${token}; Path=/; Secure` },
      }),
      close: async () => {},
    })
    .mockResolvedValueOnce({
      response: new Response('{}', {
        status: 201,
        headers: {
          'set-cookie': `baci-cart-${merchantId}=opaque; Path=/; Secure; HttpOnly`,
        },
      }),
      close: async () => {},
    })
    .mockResolvedValueOnce({
      response: new Response('{"cart":{}}'),
      close: async () => {},
    });
  const network = createPublicCartNetwork({
    origin,
    merchantSlug,
    productId,
    resolve: publicDns,
    dial,
  });
  const session = createPublicCartSession({
    origin,
    merchantSlug,
    merchantId,
    productId,
    network,
  });
  await session({ url: `${origin}/api/csrf`, method: 'GET' });
  const bootstrap = await session({
    url: `${origin}/api/storefront/cart/bootstrap`,
    method: 'POST',
    body: '{}',
  });
  const result = await session({
    url: `${origin}/api/storefront/cart`,
    method: 'GET',
  });
  expect(bootstrap).toEqual({ status: 201, body: '{}' });
  expect(result).toEqual({ status: 200, body: '{"cart":{}}' });
  expect(dial.mock.calls[2][0].headers.cookie).toContain(
    `baci-cart-${merchantId}=opaque`
  );
});
