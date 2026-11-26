import { expect, it, vi } from 'vitest';
import { createPublicCatalogReader } from './public-verification-catalog';

const origin = 'https://shop.example.com';
const productId = '33333333-3333-4333-8333-333333333333';
const settings = {
  origin,
  merchantSlug: 'synthetic',
  productId,
  productSlug: 'device',
  paths: ['/', '/collections/all', '/products/device'],
};
const resolve = async () => [{ address: '8.8.8.8', family: 4 }];
const item = {
  id: productId,
  slug: 'device',
  name: 'Synthetic',
  price: 1,
  currency: 'NGN',
  image: null,
  variants: [],
};
const network = () =>
  vi.fn(async () => ({
    response: Response.json({
      revision: 'r1',
      products: [item],
      privateField: 'discard',
    }),
    close: async () => {},
  }));

it('allows only bound anonymous catalog selections and strips unrecognized fields', async () => {
  const dial = network();
  const read = createPublicCatalogReader(settings, { resolve, network: dial });
  for (const suffix of [
    '',
    `&productId=${productId}`,
    '&productSlug=device',
    '&handle=all',
  ]) {
    const reply = await read({
      url: `${origin}/api/storefront/experience/catalog?merchantSlug=synthetic${suffix}`,
      method: 'GET',
    });
    expect(JSON.parse(reply.body)).toEqual({
      revision: 'r1',
      products: [item],
    });
  }
  expect(dial).toHaveBeenCalledTimes(4);
});

it('rejects foreign tenants and selections without contacting the network', async () => {
  const dial = network();
  const read = createPublicCatalogReader(settings, { resolve, network: dial });
  for (const suffix of [
    '?merchantSlug=other',
    '?merchantSlug=synthetic&productSlug=other',
    '?merchantSlug=synthetic&handle=private',
    '?merchantSlug=synthetic&productId=bad',
    '?merchantSlug=synthetic&productSlug=device&productSlug=other',
  ]) {
    await expect(
      read({
        url: `${origin}/api/storefront/experience/catalog${suffix}`,
        method: 'GET',
      })
    ).rejects.toThrow();
  }
  expect(dial).not.toHaveBeenCalled();
});

it('rejects a foreign selected product, private DNS and non-JSON responses', async () => {
  const selected = `${origin}/api/storefront/experience/catalog?merchantSlug=synthetic&productId=${productId}`;
  const foreign = createPublicCatalogReader(settings, {
    resolve,
    network: async () => ({
      response: Response.json({
        revision: 'r1',
        products: [{ ...item, id: 'other' }],
      }),
      close: async () => {},
    }),
  });
  await expect(foreign({ url: selected, method: 'GET' })).rejects.toThrow();
  const dial = network();
  const privateDns = createPublicCatalogReader(settings, {
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    network: dial,
  });
  await expect(privateDns({ url: selected, method: 'GET' })).rejects.toThrow();
  expect(dial).not.toHaveBeenCalled();
});
