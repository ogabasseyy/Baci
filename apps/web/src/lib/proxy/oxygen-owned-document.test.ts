import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  owned: true,
  refresh: false,
  verify: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://fixture.supabase.co',
  getSupabaseAnonKey: () => 'synthetic-anon',
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }));
vi.mock('./oxygen-document-ownership', () => ({
  verifyOxygenDocumentOwnership: mocks.verify,
}));

import { applyOwnedOxygenDocumentPolicy } from './oxygen-owned-document';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const order = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
const base = `https://shop.example/checkout?oxygenOrderId=${order}`;
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'frame.example.test');
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'frame.example.test');
  mocks.owned = true;
  mocks.refresh = false;
  mocks.create.mockImplementation((_url, _key, options) => ({ options }));
  mocks.verify.mockImplementation(async (client) => {
    if (mocks.refresh)
      client.options.cookies.setAll([
        {
          name: 'sb-fixture-auth-token.0',
          value: 'rotated',
          options: { httpOnly: true, path: '/' },
        },
      ]);
    return mocks.owned;
  });
});
it('widens only after owned tenant proof and keeps responses private', async () => {
  const request = new NextRequest(base);
  const allowed = await applyOwnedOxygenDocumentPolicy(
    NextResponse.next(),
    request,
    '/checkout',
    'shop.example',
    'test',
    'shop'
  );
  expect(mocks.verify).toHaveBeenCalledWith(expect.anything(), order, 'shop');
  expect(allowed.headers.get('content-security-policy')).toContain(
    'https://frame.example.test'
  );
  expect(allowed.headers.get('permissions-policy')).toContain(
    'https://frame.example.test'
  );
  expect(allowed.headers.get('cache-control')).toBe('private, no-store');
  mocks.owned = false;
  const denied = await applyOwnedOxygenDocumentPolicy(
    NextResponse.next(),
    request,
    '/checkout',
    'shop.example',
    'test',
    'shop'
  );
  expect(denied.headers.get('content-security-policy') ?? '').not.toContain(
    'https://frame.example.test'
  );
});
it('redirects bounded refreshes and stops a persistent rotation loop', async () => {
  mocks.refresh = true;
  const original = NextResponse.next();
  original.cookies.set('cart-session', 'synthetic-cart', {
    httpOnly: true,
    path: '/',
  });
  original.cookies.set('sb-fixture-auth-token.0', 'stale', { path: '/' });
  const result = await applyOwnedOxygenDocumentPolicy(
    original,
    new NextRequest(base),
    '/checkout',
    'shop.example',
    'test',
    'shop'
  );
  expect(result.status).toBe(307);
  expect(result.cookies.get('cart-session')).toMatchObject({
    value: 'synthetic-cart',
    httpOnly: true,
    path: '/',
  });
  expect(
    mocks.create.mock.results.at(-1)?.value.options.cookies.setAll([])
  ).toBeUndefined();
  expect(result.headers.get('location')).toContain('__oxygen_policy_refresh=');
  expect(result.cookies.get('sb-fixture-auth-token.0')?.value).toBe('rotated');
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  const repeated = await applyOwnedOxygenDocumentPolicy(
    NextResponse.next(),
    new NextRequest(`${base}&__oxygen_policy_refresh=${Date.now()}`),
    '/checkout',
    'shop.example',
    'test',
    'shop'
  );
  expect(repeated.status).toBe(307);
  expect(repeated.cookies.get('sb-fixture-auth-token.0')?.value).toBe(
    'rotated'
  );
  const third = await applyOwnedOxygenDocumentPolicy(
    NextResponse.next(),
    new NextRequest(repeated.headers.get('location') ?? ''),
    '/checkout',
    'shop.example',
    'test',
    'shop'
  );
  expect(third.status).toBe(307);
  const originalFailure = NextResponse.next();
  originalFailure.cookies.set('cart-session', 'synthetic-cart', {
    httpOnly: true,
    path: '/',
  });
  const exhausted = await applyOwnedOxygenDocumentPolicy(
    originalFailure,
    new NextRequest(third.headers.get('location') ?? ''),
    '/checkout',
    'shop.example',
    'test',
    'shop'
  );
  expect(exhausted.status).toBe(503);
  expect(exhausted.cookies.get('cart-session')).toMatchObject({
    value: 'synthetic-cart',
    httpOnly: true,
    path: '/',
  });
  expect(exhausted.headers.get('x-middleware-next')).toBeNull();
  expect(exhausted.cookies.get('sb-fixture-auth-token.0')?.value).toBe(
    'rotated'
  );
  expect(exhausted.headers.get('cache-control')).toBe('private, no-store');
  expect(exhausted.headers.get('content-security-policy') ?? '').not.toContain(
    'frame.example.test'
  );
  const stale = await applyOwnedOxygenDocumentPolicy(
    NextResponse.next(),
    new NextRequest(`${base}&__oxygen_policy_refresh=${Date.now() - 60_000}`),
    '/checkout',
    'shop.example',
    'test',
    'shop'
  );
  expect(stale.status).toBe(307);
  mocks.refresh = false;
  const fresh = await applyOwnedOxygenDocumentPolicy(
    NextResponse.next(),
    new NextRequest(repeated.headers.get('location') ?? '', {
      headers: { cookie: 'sb-fixture-auth-token.0=rotated' },
    }),
    '/checkout',
    'shop.example',
    'test',
    'shop'
  );
  expect(fresh.status).toBe(200);
  expect(fresh.headers.get('content-security-policy')).toContain(
    'https://frame.example.test'
  );
  expect(
    mocks.create.mock.results.at(-1)?.value.options.cookies.getAll()
  ).toEqual(
    expect.arrayContaining([
      { name: 'sb-fixture-auth-token.0', value: 'rotated' },
    ])
  );
});
it('does not attempt lookup for an invalid or missing tenant and query', async () => {
  mocks.create.mockClear();
  await applyOwnedOxygenDocumentPolicy(
    NextResponse.next(),
    new NextRequest(base),
    '/checkout',
    'shop.example',
    'test',
    null
  );
  await applyOwnedOxygenDocumentPolicy(
    NextResponse.next(),
    new NextRequest('https://shop.example/checkout?oxygenOrderId=bad'),
    '/checkout',
    'shop.example',
    'test',
    'shop'
  );
  expect(mocks.create).not.toHaveBeenCalled();
});
