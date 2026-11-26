import { expect, it } from 'vitest';
import {
  publicObservationPayload,
  publicObservationRoute,
  publicObservationStartFrame,
} from './experience-public-observation-payload';

const id = '11111111-1111-4111-8111-111111111111';
const digest = 'a'.repeat(64);
const origin = 'https://shop.example.com';
const route = { path: '/', title: 'Store', canonical: `${origin}/` };
const message = {
  version: 1,
  origin,
  product: { origin, merchantId: id, productId: id },
  expected: {
    buildDigest: digest,
    scriptDigest: digest,
    styleDigest: digest,
    assets: {},
    routes: [route],
    product: { id, path: '/products/device', native: true },
  },
  resources: [
    { url: route.canonical, mime: 'text/html', bytes: 'eA==', headers: {} },
  ],
};

it('parses the observation payload with a declared route and native PDP', () => {
  expect(publicObservationPayload.parse(message)).toEqual(message);
});

it('validates the observation start envelope', () => {
  expect(
    publicObservationStartFrame.parse({ type: 'start', payload: message })
  ).toEqual({ type: 'start', payload: message });
  expect(
    publicObservationStartFrame.safeParse({ type: 'done', payload: message })
      .success
  ).toBe(false);
});

it('enforces the route, resource and digest bounds', () => {
  expect(
    publicObservationRoute.safeParse({ ...route, title: '' }).success
  ).toBe(false);
  for (const patch of [
    { resources: [] },
    { expected: { ...message.expected, routes: [] } },
    { expected: { ...message.expected, buildDigest: 'bad' } },
  ]) {
    expect(
      publicObservationPayload.safeParse({ ...message, ...patch }).success
    ).toBe(false);
  }
});
