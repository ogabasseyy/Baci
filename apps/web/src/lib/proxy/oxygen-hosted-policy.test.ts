import { NextResponse } from 'next/server';
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
    false
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
