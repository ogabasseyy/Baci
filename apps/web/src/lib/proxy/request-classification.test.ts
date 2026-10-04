import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  hasStorefrontAuthSessionHint,
  safeDecodeSegment,
  sanitizeProxyRedirectPath,
} from './request-classification';

describe('proxy request classification', () => {
  it('fails closed for malformed segments and unsafe redirects', () => {
    expect(safeDecodeSegment('%E0%A4%A')).toBe('%E0%A4%A');
    expect(sanitizeProxyRedirectPath('https://evil.example')).toBe(
      '/dashboard'
    );
    expect(sanitizeProxyRedirectPath('/orders?tab=recent')).toBe(
      '/orders?tab=recent'
    );
  });

  it('recognizes storefront auth cookies without treating arbitrary cookies as auth', () => {
    expect(
      hasStorefrontAuthSessionHint(
        new NextRequest('https://shop.example', {
          headers: { cookie: 'sb-a-auth-token=value' },
        })
      )
    ).toBe(true);
    expect(
      hasStorefrontAuthSessionHint(
        new NextRequest('https://shop.example', {
          headers: { cookie: 'theme=dark' },
        })
      )
    ).toBe(false);
  });
});
