import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { buildFinalProxyResponse } from './final-response';

describe('final proxy response', () => {
  it.each([
    '127.0.0.1',
    '127.0.0.1:3250',
    'localhost:3250',
  ])('keeps development loopback %s on the direct route with verified metadata headers', (hostname) => {
    const request = new NextRequest(
      'http://127.0.0.1:3250/ogabassey/imei-check'
    );
    const response = buildFinalProxyResponse(
      request,
      '/ogabassey/imei-check',
      hostname,
      'Mozilla'
    );
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(
      response.headers.get('x-middleware-request-x-baci-metadata-cache-bucket')
    ).toBe('streaming');
    expect(response.headers.get('Vary')).toContain(
      'x-baci-metadata-cache-bucket'
    );
  });

  it('forwards a strict CSP nonce on a dashboard response', () => {
    const response = buildFinalProxyResponse(
      new NextRequest('https://usebaci.com/dashboard'),
      '/dashboard',
      'usebaci.com',
      'Mozilla'
    );
    expect(response.headers.get('x-nonce')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "script-src-attr 'none'"
    );
  });

  it('adds storefront cache-bucket variation to ordinary storefront responses', () => {
    const response = buildFinalProxyResponse(
      new NextRequest('https://shop.example/products/iphone'),
      '/products/iphone',
      'shop.example',
      'Mozilla'
    );
    expect(response.headers.get('Vary')).toContain(
      'x-baci-metadata-cache-bucket'
    );
  });
});
