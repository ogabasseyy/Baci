import { expect, it, vi } from 'vitest';
import { experienceBootstrapFingerprint } from './experience-bootstrap-fingerprint';

const bootstrap = {
  currency: 'NGN',
  assets: { hero: 'http://127.0.0.1:4101/resource/old/assets/hero' },
  route: {
    epoch: 4,
    routeId: 'product',
    canonicalPath: '/products/sample',
    params: { handle: 'sample' },
    publicDataRevision: 'revision-1',
  },
  catalog: {
    revision: 'revision-1',
    products: [
      {
        id: 'product-id',
        slug: 'sample',
        name: 'Sample product',
        price: 320,
        currency: 'NGN',
        image: { assetId: 'hero', alt: 'Sample product' },
        variants: [],
      },
    ],
  },
  capabilities: ['catalog.read'],
};

it('changes when public rendered catalog pricing changes', () => {
  const before = experienceBootstrapFingerprint(bootstrap);
  const after = experienceBootstrapFingerprint({
    ...bootstrap,
    catalog: {
      ...bootstrap.catalog,
      products: bootstrap.catalog.products.map((product) => ({
        ...product,
        price: 350,
      })),
    },
  });
  expect(after).not.toBe(before);
});

it('ignores ephemeral route epoch and rewritten immutable asset URLs', () => {
  const first = experienceBootstrapFingerprint(bootstrap);
  const second = experienceBootstrapFingerprint({
    ...bootstrap,
    assets: { hero: 'http://127.0.0.1:4101/resource/new/assets/hero' },
    route: { ...bootstrap.route, epoch: 99 },
  });
  expect(second).toBe(first);
});

it('fingerprints are independent of runtime locale collation', () => {
  const input = {
    ...bootstrap,
    route: { ...bootstrap.route, params: { b: 'b', C: 'C' } },
  };
  const before = experienceBootstrapFingerprint(input);
  const compare = vi
    .spyOn(String.prototype, 'localeCompare')
    .mockImplementation(function (this: string, other: string) {
      return this < other ? 1 : this > other ? -1 : 0;
    });
  try {
    expect(experienceBootstrapFingerprint(input)).toBe(before);
  } finally {
    compare.mockRestore();
  }
});
