import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { applySecurityHeaders } from './response-headers';

describe('proxy response headers', () => {
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
});
