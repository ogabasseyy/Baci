import { expect, it } from 'vitest';
import { buildPublicBootstrap } from './public-bootstrap';

it('constructs a new bounded public bootstrap without forwarding unknown authority', () => {
  const catalog = { products: [], revision: 'public' };
  const route = {
    epoch: 1,
    routeId: 'home',
    canonicalPath: '/',
    params: {},
    publicDataRevision: 'public',
    ownerToken: 'secret',
  };
  const result = buildPublicBootstrap(route, catalog, ['catalog.read']);
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(result.capabilities).toEqual(['catalog.read']);
});
it('rejects a public projection over the wire budget, including multibyte text', () => {
  expect(() =>
    buildPublicBootstrap(
      {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'r',
      },
      {
        revision: 'r',
        products: Array.from({ length: 100 }, (_, i) => ({
          id: String(i),
          slug: 'p',
          name: '界'.repeat(400),
          price: 1,
          currency: 'NGN',
          image: null,
          variants: [],
        })),
      },
      ['catalog.read']
    )
  ).toThrow('PUBLIC_RESPONSE_BUDGET');
});
