import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getClientIdentifier,
  getTrustedClientIdentifier,
} from './rate-limit-client';

afterEach(() => vi.unstubAllEnvs());

function requestWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/storefront/cart', {
    headers,
  });
}

describe('getClientIdentifier', () => {
  it('prefers x-real-ip over forwarded entries', () => {
    expect(
      getClientIdentifier(
        requestWith({
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '192.0.2.44',
        })
      )
    ).toBe('192.0.2.44');
  });

  it('uses the last valid forwarded entry', () => {
    expect(
      getClientIdentifier(
        requestWith({ 'x-forwarded-for': 'bad, 198.51.100.9' })
      )
    ).toBe('198.51.100.9');
  });

  it('falls back to unknown when no valid address is present', () => {
    expect(getClientIdentifier(requestWith({}))).toBe('unknown');
  });
});

describe('getTrustedClientIdentifier', () => {
  it('never trusts x-forwarded-for', () => {
    expect(
      getTrustedClientIdentifier(
        requestWith({ 'x-forwarded-for': '203.0.113.1' })
      )
    ).toBe('unknown');
  });

  it('ignores a spoofable x-real-ip without a proxy guarantee', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CART_TRUST_PROXY_HEADERS', '');
    expect(
      getTrustedClientIdentifier(requestWith({ 'x-real-ip': '192.0.2.44' }))
    ).toBe('unknown');
  });

  it('does not trust a nonempty non-sentinel VERCEL value', () => {
    vi.stubEnv('VERCEL', 'yes');
    vi.stubEnv('CART_TRUST_PROXY_HEADERS', '');
    expect(
      getTrustedClientIdentifier(requestWith({ 'x-real-ip': '192.0.2.44' }))
    ).toBe('unknown');
  });

  it('uses x-real-ip when the platform guarantees it', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getTrustedClientIdentifier(requestWith({ 'x-real-ip': '192.0.2.44' }))
    ).toBe('192.0.2.44');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CART_TRUST_PROXY_HEADERS', 'true');
    expect(
      getTrustedClientIdentifier(requestWith({ 'x-real-ip': '192.0.2.44' }))
    ).toBe('192.0.2.44');
  });
});
