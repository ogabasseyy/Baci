import { expect, it } from 'vitest';
import { ownerPreviewLaunchResponse } from './experience-owner-preview-response';

it('validates the preview launch response and requires declared routes', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const launch = {
    src: 'https://output.example.net/resource/test/index.html',
    bindingId: id,
    merchantId: id,
    buildDigest: 'a'.repeat(64),
    instanceId: id,
    nonce: id,
    expiresAt: 1800000000000,
    canonicalBase: 'https://shop.example.com/',
    routes: [{ path: '/', view: 'home' }],
    bootstrap: {
      route: {
        epoch: 1,
        routeId: 'home',
        params: {},
        canonicalPath: '/',
        publicDataRevision: '1',
      },
      catalog: { revision: '1', products: [] },
      capabilities: [],
    },
  };
  expect(ownerPreviewLaunchResponse.parse(launch)).toEqual(launch);
  expect(
    ownerPreviewLaunchResponse.safeParse({ ...launch, routes: [] }).success
  ).toBe(false);
});
