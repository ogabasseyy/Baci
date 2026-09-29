import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { config } from './proxy';

function matches(url: string, headers?: Record<string, string>): boolean {
  return unstable_doesProxyMatch({ config, url, headers });
}

describe('proxy matcher', () => {
  it.each([
    '/_next/static/a.js',
    '/_next/image',
    '/fonts/inter-naira.61440e0f45d4.woff2',
  ])('excludes static request %s', (url) => {
    expect(matches(url)).toBe(false);
  });

  it.each([
    '/phones/example-product',
    '/dashboard',
    '/api/products',
    '/favicon.ico',
    '/sitemap.xml',
    '/agent-commerce.json',
    '/agent-trust.json',
    '/baci-relay/static/relay.js',
  ])('includes proxy-owned request %s', (url) => {
    expect(matches(url)).toBe(true);
  });

  it('keeps tenant prefetch routing eligible for the proxy', () => {
    expect(
      matches('/ogabassey/phones/example-product', {
        purpose: 'prefetch',
        'next-router-prefetch': '1',
        rsc: '1',
      })
    ).toBe(true);
  });
});
