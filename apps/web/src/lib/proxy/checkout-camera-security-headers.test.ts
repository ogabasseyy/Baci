import { NextRequest, NextResponse } from 'next/server';
import { expect, it, vi } from 'vitest';
import { applySecurityHeaders } from './response-headers';

it('delegates only explicitly configured staging selfie camera origins on checkout', () => {
  const host = 'https://staging.d1l1k5yxed9cvn.amplifyapp.com';
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv(
    'OXYGEN_STAGING_HOSTED_HOSTS',
    'staging.d1l1k5yxed9cvn.amplifyapp.com'
  );
  vi.stubEnv(
    'OXYGEN_STAGING_SELFIE_HOSTS',
    'staging.d1l1k5yxed9cvn.amplifyapp.com'
  );
  try {
    const checkout = applySecurityHeaders(
      NextResponse.next(),
      '/checkout',
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest(
        'https://shop.example.test/checkout?oxygenOrderId=6974e8cc-4e90-4ca9-b2cf-aa2abaf461df'
      ),
      undefined,
      true
    );
    const product = applySecurityHeaders(
      NextResponse.next(),
      '/products/checkout',
      'Mozilla',
      'storefront',
      false
    );
    expect(checkout.headers.get('Content-Security-Policy')).toContain(host);
    const policy = checkout.headers.get('Permissions-Policy') ?? '';
    expect(policy.split(', microphone=')[0]).toContain(host);
    expect(policy.split(', microphone=')[1]).not.toContain(host);
    expect(product.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(product.headers.get('Content-Security-Policy')).not.toContain(host);
    const nested = applySecurityHeaders(
      NextResponse.next(),
      '/shop/other/checkout',
      'Mozilla',
      'storefront',
      false
    );
    expect(nested.headers.get('Content-Security-Policy')).not.toContain(host);
    const slugCheckout = applySecurityHeaders(
      NextResponse.next(),
      '/shop/checkout',
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest(
        'https://example.test/shop/checkout?oxygenOrderId=6974e8cc-4e90-4ca9-b2cf-aa2abaf461df'
      ),
      undefined,
      true
    );
    expect(slugCheckout.headers.get('Content-Security-Policy')).toContain(host);
    const payment = applySecurityHeaders(
      NextResponse.next(),
      '/payments/oxygen/6974e8cc-4e90-4ca9-b2cf-aa2abaf461df',
      'Mozilla',
      'storefront',
      false
    );
    expect(payment.headers.get('Content-Security-Policy')).not.toContain(host);
    expect(payment.headers.get('Permissions-Policy')).not.toContain(host);
    expect(payment.headers.get('Permissions-Policy')).not.toContain(
      'creditdirect'
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  '/checkout/bnpl',
  '/shop/checkout/bnpl',
  '/checkout/bnpl/',
])('delegates Credit Direct camera and microphone on the %s launcher without adding Oxygen origins', (pathname) => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'oxygen.example.com');
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'oxygen.example.com');
  try {
    const response = applySecurityHeaders(
      NextResponse.next(),
      pathname,
      'Mozilla',
      'storefront',
      false
    );
    const permissions = response.headers.get('Permissions-Policy') ?? '';
    expect(permissions).toContain(
      'camera=(self "https://checkout.creditdirect.ng"'
    );
    expect(permissions).toContain(
      'microphone=(self "https://checkout.creditdirect.ng"'
    );
    expect(permissions).not.toContain('oxygen.example.com');
    expect(response.headers.get('Content-Security-Policy')).not.toContain(
      'oxygen.example.com'
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  '/products/bnpl',
  '/shop/checkout/bnpl/other',
  '/products/checkout/bnpl',
])('keeps camera and microphone disabled on unrelated path %s', (pathname) => {
  const response = applySecurityHeaders(
    NextResponse.next(),
    pathname,
    'Mozilla',
    'storefront',
    false
  );
  expect(response.headers.get('Permissions-Policy')).toContain(
    'camera=(), microphone=()'
  );
});
