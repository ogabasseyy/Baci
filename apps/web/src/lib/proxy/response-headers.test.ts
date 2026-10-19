import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
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
