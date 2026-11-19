import { expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => vi.fn());
vi.mock('./experience-launch-client', () => ({
  readExperienceCatalog: catalog,
  readExperiencePublicationState: vi.fn(),
  renewExperienceLaunch: vi.fn(),
}));

import { createPublishedExperienceHost } from './experience-host-runtime';
import { createExperienceShellController } from './experience-shell-controller';

function fixture(ownsProduct = false) {
  const controller = createExperienceShellController();
  const data = {
    manifest: {
      buildDigest: 'a'.repeat(64),
      capabilities: ['navigation', 'catalog.read'],
      routes: [
        { path: '/', view: 'home' },
        ...(ownsProduct
          ? [{ path: '/products/[handle]', view: 'product' }]
          : []),
      ],
    },
    launch: { instanceId: 'instance', canonicalBase: 'http://localhost/qa1' },
    stateUrl: '/api/storefront/experience/state',
    bootstrap: {
      route: { epoch: 1, canonicalPath: '/' },
      catalog: { products: [], revision: 'revision' },
    },
  };
  controller.activate('home', data as never);
  const push = vi.fn();
  const runtime = createPublishedExperienceHost({
    controller,
    live: { current: { cart: null, router: { push, refresh: vi.fn() } } },
    merchantSlug: 'qa1',
    present: vi.fn(),
  });
  return { controller, data, push, runtime };
}

it.each([
  '/phones/device',
  '/products/device',
])('resolves a fetched native product outside the bootstrap: %s', async (path) => {
  const f = fixture();
  catalog.mockResolvedValue({
    products: [
      { id: 'product', slug: 'device', canonicalPath: '/phones/device' },
    ],
  });
  await expect(f.runtime.host.navigate(path)).resolves.toMatchObject({
    canonicalPath: '/phones/device',
  });
  expect(catalog).toHaveBeenCalledWith(f.data.stateUrl, {
    productSlug: 'device',
  });
  expect(f.push).toHaveBeenCalledWith('/qa1/phones/device');
  expect(f.controller.getSnapshot()).toBeNull();
});

it('waits for the authored boundary for freshly resolved owned products', async () => {
  const f = fixture(true);
  catalog.mockResolvedValue({
    products: [
      { id: 'product', slug: 'device', canonicalPath: '/phones/device' },
    ],
  });
  f.push.mockImplementation(() =>
    f.controller.activate('product', {
      ...f.data,
      bootstrap: {
        ...f.data.bootstrap,
        route: { epoch: 2, canonicalPath: '/phones/device' },
      },
    } as never)
  );
  await expect(
    f.runtime.host.navigate('/phones/device')
  ).resolves.toMatchObject({ epoch: 2, canonicalPath: '/phones/device' });
  expect(f.controller.getSnapshot()?.active).toBe(true);
});

it('does not navigate when a trusted lookup fails or returns a different product', async () => {
  const f = fixture();
  catalog.mockResolvedValue({
    products: [
      { id: 'other', slug: 'different', canonicalPath: '/phones/different' },
    ],
  });
  await expect(f.runtime.host.navigate('/phones/device')).rejects.toThrow(
    'INVALID_ROUTE'
  );
  catalog.mockRejectedValue(Error('offline'));
  await expect(f.runtime.host.navigate('/phones/device')).rejects.toThrow();
  expect(f.push).not.toHaveBeenCalled();
});

it('does not use a lookup result after its launch is withdrawn', async () => {
  const f = fixture();
  catalog.mockImplementation(async () => {
    f.controller.withdraw();
    return { products: [{ slug: 'device', canonicalPath: '/phones/device' }] };
  });
  await expect(f.runtime.host.navigate('/phones/device')).rejects.toThrow();
  expect(f.push).not.toHaveBeenCalled();
});
