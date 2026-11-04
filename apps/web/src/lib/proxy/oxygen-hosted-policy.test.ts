import { NextRequest, NextResponse } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { applySecurityHeaders } from './response-headers';

afterEach(() => vi.unstubAllEnvs());
it('allows only exact configured hosted origins and delegates camera only to selfie hosts on nonlocal checkout', () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv(
    'OXYGEN_STAGING_HOSTED_HOSTS',
    'frame.example.test,payment.example.test'
  );
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'frame.example.test');
  const response = applySecurityHeaders(
    NextResponse.next(),
    '/shop/checkout',
    'test',
    'storefront',
    false,
    undefined,
    new NextRequest(
      'https://shop.example.test/shop/checkout?oxygenOrderId=6974e8cc-4e90-4ca9-b2cf-aa2abaf461df'
    ),
    undefined,
    true
  );
  const csp = response.headers.get('Content-Security-Policy') ?? '';
  const camera = response.headers.get('Permissions-Policy') ?? '';
  expect(csp).toContain('https://frame.example.test');
  expect(csp).toContain('https://payment.example.test');
  expect(camera.split(', microphone=')[0]).toContain(
    'https://frame.example.test'
  );
  expect(camera).not.toContain('https://payment.example.test');
  expect(camera.split(', microphone=')[1]).not.toContain(
    'https://frame.example.test'
  );
});
it('does not extend policies for disabled production or admin routes', () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', '');
  vi.stubEnv('OXYGEN_PRODUCTION_HOSTED_HOSTS', 'live.example.test');
  vi.stubEnv('OXYGEN_PRODUCTION_SELFIE_HOSTS', 'live.example.test');
  const response = applySecurityHeaders(
    NextResponse.next(),
    '/checkout',
    'test',
    'storefront',
    false
  );
  expect(response.headers.get('Content-Security-Policy')).not.toContain(
    'live.example.test'
  );
  expect(response.headers.get('Permissions-Policy')).not.toContain(
    'live.example.test'
  );
  vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', 'true');
  const admin = applySecurityHeaders(
    NextResponse.next(),
    '/dashboard',
    'test',
    'admin',
    false
  );
  expect(admin.headers.get('Content-Security-Policy')).not.toContain(
    'live.example.test'
  );
  expect(admin.headers.get('Permissions-Policy')).toContain('camera=()');
});

it.each([
  '/payments/oxygen/not-a-uuid',
  '/payments/oxygen/11111111-1111-1111-1111-111111111111',
])('withholds Oxygen frames and camera for invalid payment route %s', (path) => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'frame.example.test');
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'frame.example.test');
  const response = applySecurityHeaders(
    NextResponse.next(),
    path,
    'test',
    'storefront',
    false
  );
  expect(response.headers.get('Content-Security-Policy')).not.toContain(
    'frame.example.test'
  );
  expect(response.headers.get('Permissions-Policy')).toContain(
    'camera=(), microphone=()'
  );
});

it.each([
  '/checkout',
  '/shop/checkout',
])('limits Oxygen policy on %s to a single valid order query', (path) => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'frame.example.test');
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'frame.example.test');
  const order = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
  for (const [query, expected] of [
    ['', false],
    ['?oxygenOrderId=bad', false],
    [`?oxygenOrderId=${order}&oxygenOrderId=${order}`, false],
    [`?oxygenOrderId=${order}`, true],
  ] as const) {
    const request = new NextRequest(`https://shop.example.test${path}${query}`);
    const response = applySecurityHeaders(
      NextResponse.next(),
      path,
      'test',
      'storefront',
      false,
      undefined,
      request,
      undefined,
      true
    );
    expect(
      response.headers
        .get('Content-Security-Policy')
        ?.includes('https://frame.example.test')
    ).toBe(expected);
    expect(
      response.headers
        .get('Permissions-Policy')
        ?.includes('https://frame.example.test')
    ).toBe(expected);
    expect(response.headers.get('Permissions-Policy')).toContain(
      'https://checkout.creditdirect.ng'
    );
  }
});
