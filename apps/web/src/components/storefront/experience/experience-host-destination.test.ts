import { expect, it, vi } from 'vitest';

const read = vi.hoisted(() => vi.fn());
vi.mock('./experience-launch-client', () => ({ readExperienceCatalog: read }));

import { resolveHostDestination } from './experience-host-destination';

const state = () => ({
  active: true,
  data: {
    stateUrl: '/trusted/state',
    manifest: {
      routes: [{ path: '/products/[handle]', view: 'product' }],
      capabilities: ['catalog.read'],
    },
    bootstrap: {
      catalog: {
        products: [{ slug: 'current', canonicalPath: '/phones/current' }],
      },
    },
  },
});
it('resolves fetched related products through the trusted public catalog without navigation', async () => {
  const s = state();
  read.mockResolvedValue({
    products: [{ slug: 'related', canonicalPath: '/phones/related' }],
  });
  expect(
    await resolveHostDestination(
      s as never,
      '/phones/related',
      () => s as never
    )
  ).toMatchObject({
    destination: '/phones/related',
    owned: { view: 'product' },
  });
  expect(read).toHaveBeenCalledWith('/trusted/state', {
    productSlug: 'related',
  });
});
it('rejects missing products, forbidden destinations and stale catalog replies', async () => {
  const s = state();
  read.mockResolvedValue({ products: [] });
  await expect(
    resolveHostDestination(s as never, '/phones/missing', () => s as never)
  ).rejects.toThrow('INVALID_ROUTE');
  await expect(
    resolveHostDestination(s as never, '/admin', () => s as never)
  ).rejects.toThrow('INVALID_ROUTE');
  read.mockResolvedValue({
    products: [{ slug: 'related', canonicalPath: '/phones/related' }],
  });
  await expect(
    resolveHostDestination(s as never, '/phones/related', () => null)
  ).rejects.toThrow('INVALID_ROUTE');
});
