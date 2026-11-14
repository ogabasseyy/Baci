import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  policy: vi.fn(async (response) => response),
}));
vi.mock('./oxygen-owned-document', () => ({
  applyOwnedOxygenDocumentPolicy: mocks.policy,
}));
vi.mock('./storefront-preflight', () => ({
  runStorefrontPreflight: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));

import { buildFinalProxyResponse } from './final-response';
import { runSubdomainRouting } from './subdomain-routing';

it('uses the root storefront path, never a forwarded merchant header, as the tenant', async () => {
  const request = new NextRequest(
    'https://usebaci.com/shop/checkout?oxygenOrderId=6974e8cc-4e90-4ca9-b2cf-aa2abaf461df',
    { headers: { 'x-merchant-slug': 'forged' } }
  );
  await buildFinalProxyResponse(
    request,
    '/shop/checkout',
    'usebaci.com',
    'test'
  );
  expect(mocks.policy).toHaveBeenLastCalledWith(
    expect.anything(),
    request,
    '/shop/checkout',
    'usebaci.com',
    'test',
    'shop'
  );
});

it('uses the validated subdomain routing context as the tenant', async () => {
  const request = new NextRequest(
    'http://shop.localhost/checkout?oxygenOrderId=6974e8cc-4e90-4ca9-b2cf-aa2abaf461df',
    { headers: { 'x-merchant-slug': 'forged' } }
  );
  await runSubdomainRouting(
    request,
    '/checkout',
    'shop.localhost',
    'test',
    'shop'
  );
  expect(mocks.policy).toHaveBeenLastCalledWith(
    expect.anything(),
    request,
    '/checkout',
    'shop.localhost',
    'test',
    'shop'
  );
});
