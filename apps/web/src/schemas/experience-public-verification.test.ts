import { expect, it } from 'vitest';
import { experiencePublicObservation } from './experience-public-verification';

const digest = 'a'.repeat(64);
const sample = {
  parentBuild: digest,
  frameBuild: digest,
  scriptDigest: digest,
  styleDigest: digest,
  routes: [
    { path: '/', title: 'Home', canonical: 'https://shop.test', status: 200 },
  ],
  journey: {
    steps: [{ action: 'navigate', path: '/', evidenceDigest: digest }],
    orderRequests: 0,
    paymentRequests: 0,
  },
  assets: { 'assets/product': digest },
  evidenceDigest: digest,
};
it('accepts a bounded observation with no transactional requests', () => {
  expect(experiencePublicObservation.parse(sample)).toEqual(sample);
});
it('rejects unsafe journeys and malformed verification evidence', () => {
  for (const patch of [
    { frameBuild: 'bad' },
    { routes: [] },
    { routes: [{ ...sample.routes[0], status: 404 }] },
    { routes: [{ ...sample.routes[0], canonical: 'not-a-url' }] },
    { journey: { ...sample.journey, orderRequests: 1 } },
    { journey: { ...sample.journey, paymentRequests: 1 } },
    {
      journey: {
        ...sample.journey,
        steps: Array.from({ length: 33 }, () => sample.journey.steps[0]),
      },
    },
    { assets: { 'assets/product': 'bad' } },
    { approved: true },
  ])
    expect(
      experiencePublicObservation.safeParse({ ...sample, ...patch }).success
    ).toBe(false);
});
