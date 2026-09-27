import { expect, it } from 'vitest';
import { isFixtureAssetRequest } from './request-allowlist';

const request = {
  url: 'http://127.0.0.1:3217/checkout',
  method: 'GET',
  resourceType: 'document',
};
it('permits fixture navigation and Next RSC navigation', () => {
  expect(isFixtureAssetRequest(request)).toBe(true);
  expect(
    isFixtureAssetRequest({
      ...request,
      resourceType: 'fetch',
      url: `${request.url}?_rsc=fixture`,
      rsc: '1',
    })
  ).toBe(true);
});
it.each([
  'fetch',
  'xhr',
])('rejects an unexpected same-origin %s path', (resourceType) => {
  expect(
    isFixtureAssetRequest({
      ...request,
      resourceType,
      url: 'http://127.0.0.1:3217/unexpected-data',
    })
  ).toBe(false);
});
it('does not allow mutations or third-party assets', () => {
  expect(isFixtureAssetRequest({ ...request, method: 'POST' })).toBe(false);
  expect(
    isFixtureAssetRequest({
      ...request,
      url: 'https://example.test/image.svg',
      resourceType: 'image',
    })
  ).toBe(false);
});
it('permits generated styles and local images/fonts', () => {
  for (const path of [
    '/_next/static/chunks/fixture.css',
    '/phone.svg',
    '/fonts/inter.woff2',
  ])
    expect(
      isFixtureAssetRequest({
        ...request,
        resourceType: 'other',
        url: `http://127.0.0.1:3217${path}`,
      })
    ).toBe(true);
});
