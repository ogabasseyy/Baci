import type { PublicBootstrap } from '@baci/shared/experience';
import { expect, it } from 'vitest';
import { createMockCommerce } from './mock-commerce';

const fixtures: PublicBootstrap = {
  capabilities: [],
  route: {
    epoch: 1,
    routeId: 'home',
    canonicalPath: '/',
    params: {},
    publicDataRevision: '1',
  },
  catalog: {
    revision: '1',
    products: [
      {
        id: 'device',
        slug: 'device',
        name: 'Synthetic Device',
        price: 10,
        currency: 'USD',
        image: null,
        variants: [{ id: 'blue', label: 'Blue', available: true }],
      },
    ],
  },
};

it('updates a private synthetic cart and returns detached snapshots', async () => {
  const commerce = createMockCommerce(fixtures);
  const first = await commerce.cart.add({
    productId: 'device',
    variantId: 'blue',
    quantity: 2,
  });
  if (first.status !== 'ok') throw Error('Expected a synthetic cart');
  expect(first.value).toMatchObject({ total: 20, version: 2, currency: 'USD' });
  const lineId = first.value.lines[0].lineId;
  await expect(commerce.cart.setQuantity(lineId, 3)).resolves.toMatchObject({
    status: 'ok',
    value: { total: 30, version: 3 },
  });
  expect(first.value.lines[0].quantity).toBe(2);
  await expect(commerce.cart.remove(lineId)).resolves.toMatchObject({
    status: 'ok',
    value: { lines: [], total: 0 },
  });
  await expect(commerce.checkout.open()).resolves.toEqual({
    status: 'ok',
    value: { presented: false },
  });
});
it('rejects unknown variants, quantities and unsafe paths without mutating state', async () => {
  const commerce = createMockCommerce(fixtures);
  for (const args of [
    { variantId: 'missing', quantity: 1 },
    { variantId: 'blue', quantity: 0 },
    { variantId: 'blue', quantity: 1000 },
  ]) {
    await expect(
      commerce.cart.add({ productId: 'device', ...args })
    ).resolves.toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
  }
  for (const path of [
    '//outside.test',
    '/../checkout',
    '/%2foutside',
    '/path?query=true',
  ]) {
    await expect(commerce.navigation.go(path)).resolves.toMatchObject({
      status: 'error',
      code: 'INVALID_REQUEST',
    });
  }
  await expect(commerce.cart.readPublic()).resolves.toMatchObject({
    status: 'ok',
    value: { lines: [], version: 1 },
  });
  await expect(
    commerce.navigation.go('/products/device')
  ).resolves.toMatchObject({
    status: 'ok',
    value: { epoch: 2, canonicalPath: '/products/device' },
  });
});
