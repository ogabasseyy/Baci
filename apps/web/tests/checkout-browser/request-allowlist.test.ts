import { afterEach, expect, it, vi } from 'vitest';
import {
  isChatwootBridgeFixtureRequest,
  isFixtureAssetRequest,
} from './request-allowlist';

const request = {
  url: 'http://127.0.0.1:3217/checkout',
  method: 'GET',
  resourceType: 'document',
};
afterEach(() => vi.unstubAllEnvs());
it('limits Chatwoot harness traffic to its exact origins, paths, methods, and visited state', () => {
  const harnessOrigin = 'http://127.0.0.1:3217';
  const request = (url: string, method: string, fixtureVisited = true) =>
    isChatwootBridgeFixtureRequest({
      url,
      method,
      harnessOrigin,
      fixtureVisited,
    });

  expect(request(`${harnessOrigin}/chatwoot-bridge`, 'GET', false)).toBe(true);
  for (const origin of [
    'https://support.example.test',
    'https://untrusted.example.test',
  ])
    expect(request(`${origin}/widget`, 'GET')).toBe(true);
  for (const endpoint of ['challenge', 'verify', 'authorize'])
    expect(
      request(
        `${harnessOrigin}/api/storefront/chatwoot/context/${endpoint}?merchantSlug=ogabassey`,
        'POST'
      )
    ).toBe(true);

  expect(request('https://other.example.test/widget', 'GET')).toBe(false);
  expect(request('https://support.example.test/other', 'GET')).toBe(false);
  expect(request('https://support.example.test/widget', 'POST')).toBe(false);
  expect(
    request(`${harnessOrigin}/api/storefront/chatwoot/context/other`, 'POST')
  ).toBe(false);
  expect(
    request(`${harnessOrigin}/api/storefront/chatwoot/context/challenge`, 'GET')
  ).toBe(false);
  expect(request('https://support.example.test/widget', 'GET', false)).toBe(
    false
  );
  expect(
    request(
      `${harnessOrigin}/api/storefront/chatwoot/context/challenge`,
      'POST',
      false
    )
  ).toBe(false);
});

it('permits fixture navigation and Next RSC navigation', () => {
  expect(isFixtureAssetRequest(request)).toBe(true);
  expect(
    isFixtureAssetRequest({
      ...request,
      url: 'http://127.0.0.1:3217/cart-navigation-start',
    })
  ).toBe(true);
  expect(
    isFixtureAssetRequest({
      ...request,
      url: 'http://127.0.0.1:3217/crypto-payment-modal',
    })
  ).toBe(true);
  expect(
    isFixtureAssetRequest({
      ...request,
      url: 'http://127.0.0.1:3217/dva-modal',
    })
  ).toBe(true);
  expect(
    isFixtureAssetRequest({
      ...request,
      url: 'http://127.0.0.1:3217/products/test-phone',
    })
  ).toBe(true);
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
it('uses the configured harness port', () => {
  vi.stubEnv('CHECKOUT_BROWSER_PORT', '4321');
  expect(
    isFixtureAssetRequest({
      ...request,
      url: 'http://127.0.0.1:4321/checkout',
    })
  ).toBe(true);
  expect(isFixtureAssetRequest(request)).toBe(false);
});
