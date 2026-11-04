import { expect, it, vi } from 'vitest';
import { createFrameDispatcher } from './experience-frame-dispatcher';
import { createRouteCoordinator } from './experience-route-coordinator';

it('delegates published commerce only to its trusted host and presents navigation outside source', async () => {
  const dispatch = vi.fn(async () => ({ status: 'ok', value: 'normal host' }));
  const presentCanonicalLink = vi.fn(() => ({
    href: 'https://store.test/product',
  }));
  const setLink = vi.fn();
  const run = createFrameDispatcher({
    host: { dispatch } as never,
    launch: {} as never,
    nav: { presentCanonicalLink } as never,
    setLink,
    routes: {} as never,
  });
  expect(await run({ method: 'cart.readPublic' } as never)).toMatchObject({
    status: 'ok',
    value: 'normal host',
  });
  await run({
    method: 'navigation.open',
    requestId: 'one',
    args: { path: '/product' },
  } as never);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(setLink).toHaveBeenCalledWith({ href: 'https://store.test/product' });
});

it.each([
  'product',
  'collection',
] as const)('commits %s preview handles through the real coordinator', async (view) => {
  const path = view === 'product' ? '/products/device' : '/collections/devices';
  const routes = createRouteCoordinator({
    epoch: 1,
    routeId: 'home',
    canonicalPath: '/',
    params: {},
    publicDataRevision: 'r',
  });
  const run = createFrameDispatcher({
    launch: {
      canonicalBase: 'https://shop.example',
      routes: [
        {
          path:
            view === 'product' ? '/products/[handle]' : '/collections/[handle]',
          view,
        },
      ],
      bootstrap: {
        catalog: { revision: 'r', products: [] },
        capabilities: ['navigation'],
      },
    } as never,
    nav: { cancel: vi.fn() } as never,
    setLink: vi.fn(),
    routes,
  });
  expect(
    await run({
      method: 'navigation.go',
      requestId: 'nav',
      args: { path },
    } as never)
  ).toMatchObject({
    status: 'ok',
    value: {
      routeId: view,
      params: { handle: view === 'product' ? 'device' : 'devices' },
    },
  });
});
