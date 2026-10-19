import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  buildStrictCspResponse,
  generateCSP,
  shouldForwardStrictCspNonce,
} from './csp';

describe('proxy CSP', () => {
  it('uses a nonce only for admin and auth document routes', () => {
    expect(shouldForwardStrictCspNonce('admin')).toBe(true);
    expect(shouldForwardStrictCspNonce('storefront')).toBe(false);
    expect(generateCSP('admin', false, 'safe_nonce')).toContain(
      "'nonce-safe_nonce'"
    );
    expect(generateCSP('storefront', false)).toContain("'unsafe-inline'");
  });

  it('forwards exactly the generated strict CSP to the request', () => {
    const { nonce, response } = buildStrictCspResponse(
      new NextRequest('https://usebaci.com/dashboard'),
      'admin',
      false
    );
    const forwarded = response.headers.get(
      'x-middleware-request-content-security-policy'
    );
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(forwarded).toContain(`'nonce-${nonce}'`);
  });
});
