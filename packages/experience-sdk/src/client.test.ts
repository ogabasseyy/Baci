import { expect, it, vi } from 'vitest';
import { createCommerceClient } from './client';
import { createMockCommerce } from './mock-commerce';

it('uses typed bridge methods; mock commerce never fetches or creates transactions', async () => {
  const transport = vi.fn(async () => ({ status: 'ok' as const, value: {} }));
  const client = createCommerceClient(transport);
  await client.cart.add({ productId: 'p', quantity: 2 });
  expect(transport).toHaveBeenCalledWith('cart.add', {
    productId: 'p',
    quantity: 2,
  });
  const network = vi.spyOn(globalThis, 'fetch');
  const mock = createMockCommerce({
    capabilities: [],
    catalog: {
      revision: '1',
      products: [
        {
          id: 'p',
          slug: 'p',
          name: 'Synthetic',
          price: 10,
          currency: 'USD',
          image: null,
          variants: [],
        },
      ],
    },
    route: {
      epoch: 1,
      routeId: 'home',
      params: {},
      canonicalPath: '/',
      publicDataRevision: '1',
    },
  });
  const r = await mock.cart.add({ productId: 'p', quantity: 2 });
  expect(r).toMatchObject({
    status: 'ok' as const,
    value: { total: 20, currency: 'USD' },
  });
  await mock.checkout.prepare();
  await mock.checkout.open();
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});

it('reconciles the original cart operation ID without submitting a new mutation', async () => {
  const send = vi.fn(async () => ({
    status: 'indeterminate' as const,
    operationId: 'original',
  }));
  const client = createCommerceClient(send);
  expect(await client.cart.reconcile('original')).toEqual({
    status: 'indeterminate',
    operationId: 'original',
  });
  expect(send).toHaveBeenCalledExactlyOnceWith('cart.reconcile', {
    operationId: 'original',
  });
});
