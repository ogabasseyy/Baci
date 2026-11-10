import { expect, it, vi } from 'vitest';
import { verifyPublicExperience } from './public-verifier';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const c = 'c'.repeat(64);
const expected = {
  buildDigest: a,
  scriptDigest: b,
  styleDigest: c,
  routes: ['/', '/collections/all', '/products/device', '/pages/story'].map(
    (path) => ({
      path,
      title: 'Synthetic page',
      canonical: `http://127.0.0.1:43174/qa1${path}`,
    })
  ),
  journeySteps: [
    { action: 'navigate' as const, path: '/' },
    { action: 'product' as const, path: '/products/device' },
    { action: 'cart-add' as const, path: '/products/device' },
    { action: 'cart-read' as const, path: '/cart' },
    { action: 'checkout-review' as const, path: '/checkout' },
  ],
  assets: { image: b },
  publicationRevision: 1,
};
const observation = {
  parentBuild: a,
  frameBuild: a,
  scriptDigest: b,
  styleDigest: c,
  routes: expected.routes.map((route) => ({ ...route, status: 200 })),
  journey: {
    steps: expected.journeySteps.map((step) => ({
      ...step,
      evidenceDigest: c,
    })),
    orderRequests: 0,
    paymentRequests: 0,
  },
  assets: { image: b },
  evidenceDigest: c,
};
it('records independently observed parent/frame/network/routes/assets only after current-head recheck', async () => {
  const record = vi.fn();
  await expect(
    verifyPublicExperience(expected, {
      observe: async () => observation,
      current: async () => ({ buildDigest: a, publicationRevision: 1 }),
      record,
    })
  ).resolves.toMatchObject({ status: 'verified' });
  expect(record).toHaveBeenCalledOnce();
});
it('rejects self-reported success, wrong artifacts or superseded heads without recording proof', async () => {
  for (const value of [
    { passed: true },
    { ...observation, frameBuild: b },
    {
      ...observation,
      routes: observation.routes.map((r) => ({
        ...r,
        canonical: 'https://other-merchant.invalid/',
      })),
    },
    { ...observation, journey: { ...observation.journey, steps: [] } },
    { ...observation, journey: { ...observation.journey, orderRequests: 1 } },
    { ...observation, scriptDigest: a },
    { ...observation, routes: observation.routes.slice(1) },
  ]) {
    const record = vi.fn();
    await expect(
      verifyPublicExperience(expected, {
        observe: async () => value,
        current: async () => ({ buildDigest: a, publicationRevision: 1 }),
        record,
      })
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  }
  const record = vi.fn();
  await expect(
    verifyPublicExperience(expected, {
      observe: async () => observation,
      current: async () => ({ buildDigest: b, publicationRevision: 2 }),
      record,
    })
  ).rejects.toThrow('SUPERSEDED');
  expect(record).not.toHaveBeenCalled();
});
