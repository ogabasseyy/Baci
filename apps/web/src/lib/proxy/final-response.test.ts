import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { buildFinalProxyResponse } from './final-response';

describe('final proxy response', () => {
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
