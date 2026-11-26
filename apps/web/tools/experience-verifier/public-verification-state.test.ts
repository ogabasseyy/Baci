import { expect, it, vi } from 'vitest';
import { createPublicStateReader } from './public-verification-state';

const binding = {
  canonicalBase: 'https://shop.example',
  slug: 'synthetic',
  buildDigest: 'a'.repeat(64),
  policyRevision: 'policy-1',
};
const stateUrl = `${binding.canonicalBase}/api/storefront/experience/state?merchantSlug=synthetic&buildDigest=${binding.buildDigest}&path=%2F`;
const resolve = async () => [{ address: '8.8.8.8', family: 4 }];
const state = {
  active: true,
  status: 'active',
  buildDigest: binding.buildDigest,
  policyRevision: binding.policyRevision,
  catalogRevision: 'catalog-1',
};
const network = () =>
  vi.fn(async () => ({
    response: Response.json(state),
    close: async () => {},
  }));

it('reads only the exact bound route and returns validated current state', async () => {
  const dial = network();
  const read = createPublicStateReader(binding, ['/'], {
    resolve,
    network: dial,
  });
  const result = await read({ url: stateUrl, method: 'GET' });
  expect(JSON.parse(result.body)).toEqual(state);
  expect(dial).toHaveBeenCalledOnce();
});

it('denies foreign tenants, paths, methods, extra parameters and request bodies without networking', async () => {
  const dial = network();
  const read = createPublicStateReader(binding, ['/'], {
    resolve,
    network: dial,
  });
  for (const request of [
    { url: stateUrl.replace('synthetic', 'other'), method: 'GET' },
    { url: stateUrl.replace('%2F', '%2Fadmin'), method: 'GET' },
    { url: `${stateUrl}&x=1`, method: 'GET' },
    { url: stateUrl, method: 'POST' },
    { url: stateUrl, method: 'GET', body: '{}' },
  ])
    await expect(read(request)).rejects.toThrow();
  expect(dial).not.toHaveBeenCalled();
});

it('fails closed on stale state, malformed responses and private DNS', async () => {
  for (const result of [
    { ...state, active: false },
    { ...state, buildDigest: 'b'.repeat(64) },
    { ...state, policyRevision: 'other' },
    { ...state, secret: 'bad' },
  ]) {
    const read = createPublicStateReader(binding, ['/'], {
      resolve,
      network: async () => ({
        response: Response.json(result),
        close: async () => {},
      }),
    });
    await expect(read({ url: stateUrl, method: 'GET' })).rejects.toThrow();
  }
  const dial = network();
  const read = createPublicStateReader(binding, ['/'], {
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    network: dial,
  });
  await expect(read({ url: stateUrl, method: 'GET' })).rejects.toThrow();
  expect(dial).not.toHaveBeenCalled();
});
