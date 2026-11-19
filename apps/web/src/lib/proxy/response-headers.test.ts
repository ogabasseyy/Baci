import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { installExperienceExecutionOrigin } from '@/lib/experience/execution-origin-runtime';
import { applySecurityHeaders } from './response-headers';

describe('proxy response headers', () => {
  it.each([
    ['session', '', 'GET', 'sb-project-auth-token=session'],
    ['query', '?_rsc=hash', 'GET', ''],
    ['mutation', '', 'POST', ''],
  ])('clears stale CDN headers for rejected %s nested listings', (_, query, method, cookie) => {
    const pathname = '/smartphones/best-under/500000';
    const response = applySecurityHeaders(
      NextResponse.next({
        headers: {
          'CDN-Cache-Control': 'max-age=3600',
          'Vercel-CDN-Cache-Control': 'max-age=300',
          'Vercel-Cache-Tag': 'stale-tag',
        },
      }),
      pathname,
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest(`https://ogabassey.com${pathname}${query}`, {
        method,
        headers: { cookie },
      }),
      'ogabassey.com'
    );
    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0, must-revalidate'
    );
    expect(response.headers.get('CDN-Cache-Control')).toBeNull();
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
    expect(response.headers.get('Vercel-Cache-Tag')).toBeNull();
    if (cookie) expect(response.headers.get('Vary')).toContain('Cookie');
  });

  it('makes static assets immutable while retaining core security headers', () => {
    const response = applySecurityHeaders(
      NextResponse.next(),
      '/images/logo.svg',
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest('https://shop.example/images/logo.svg'),
      'shop.example'
    );
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(response.headers.get('Strict-Transport-Security')).toContain(
      'includeSubDomains'
    );
  });

  it('delegates checkout camera access but keeps other storefront pages disabled', () => {
    const checkout = applySecurityHeaders(
      NextResponse.next(),
      '/checkout',
      'Mozilla',
      'storefront',
      false
    );
    const product = applySecurityHeaders(
      NextResponse.next(),
      '/products/iphone',
      'Mozilla',
      'storefront',
      false
    );
    expect(checkout.headers.get('Permissions-Policy')).toContain(
      'checkout.creditdirect.ng'
    );
    expect(product.headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('preserves accepted nested-listing cache headers without downstream expansion', () => {
    const response = applySecurityHeaders(
      NextResponse.next(),
      '/smartphones/best-under/500000',
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest('https://ogabassey.com/smartphones/best-under/500000'),
      'ogabassey.com'
    );

    expect(response.headers.get('Cache-Control')).toBe(
      's-maxage=300, stale-while-revalidate=86400'
    );
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
    expect(response.headers.get('CDN-Cache-Control')).toBeNull();
  });

  it.each([
    ['RSC', { rsc: '1' }],
    ['router prefetch', { 'next-router-prefetch': '1' }],
    ['router state tree', { 'next-router-state-tree': 'tree' }],
    ['non-document destination', { 'sec-fetch-dest': 'empty' }],
  ])('keeps header-only %s requests out of normal public HTML caches', (_, headers) => {
    const response = applySecurityHeaders(
      NextResponse.next({
        headers: {
          'CDN-Cache-Control': 'max-age=3600',
          'Vercel-CDN-Cache-Control': 'max-age=300',
          'Vercel-Cache-Tag': 'storefront-publication:hostname:ogabassey.com',
        },
      }),
      '/products/iphone',
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest('https://ogabassey.com/products/iphone', { headers }),
      'ogabassey.com'
    );

    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0, must-revalidate'
    );
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
    expect(response.headers.get('CDN-Cache-Control')).toBeNull();
    expect(response.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it.each([
    ['RSC', { rsc: '1' }],
    ['router prefetch', { 'next-router-prefetch': '1' }],
    ['router state tree', { 'next-router-state-tree': 'tree' }],
    ['non-document destination', { 'sec-fetch-dest': 'empty' }],
  ])('removes all CDN cache headers from header-only %s nested-listing requests', (_, headers) => {
    const response = applySecurityHeaders(
      NextResponse.next({
        headers: {
          'CDN-Cache-Control': 'max-age=3600',
          'Vercel-CDN-Cache-Control': 'max-age=300',
          'Vercel-Cache-Tag': 'storefront-publication:hostname:ogabassey.com',
        },
      }),
      '/smartphones/best-under/500000',
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest('https://ogabassey.com/smartphones/best-under/500000', {
        headers,
      }),
      'ogabassey.com'
    );

    expect(response.headers.get('Cache-Control')).toBe(
      'private, no-store, max-age=0, must-revalidate'
    );
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
    expect(response.headers.get('CDN-Cache-Control')).toBeNull();
    expect(response.headers.get('Vercel-Cache-Tag')).toBeNull();
  });
});

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

it('grants execution framing only to the private builder response among admin pages', () => {
  const uninstall = installExperienceExecutionOrigin(
    'https://execution.example.net'
  );
  try {
    for (const pathname of ['/builder/experience/preview', '/dashboard']) {
      const response = applySecurityHeaders(
        NextResponse.next(),
        pathname,
        'Mozilla',
        'admin',
        false,
        'nonce'
      );
      const policy = response.headers.get('content-security-policy') ?? '';
      expect(policy.includes('https://execution.example.net')).toBe(
        pathname === '/builder/experience/preview'
      );
    }
  } finally {
    uninstall();
  }
});
