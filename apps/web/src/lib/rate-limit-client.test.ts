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

describe('getClientIdentifier behind Cloudflare', () => {
  it('does not trust Cloudflare headers without a proxy guarantee', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CART_TRUST_PROXY_HEADERS', '');
    expect(
      getClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': 'anything',
          'x-real-ip': '172.68.1.20',
        })
      )
    ).toBe('172.68.1.20');
  });

  it('uses the visitor address when the peer is a Cloudflare egress', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': 'a509c917eae1b920-AMS',
          'x-real-ip': '172.68.1.20',
          'x-forwarded-for': '203.0.113.9, 172.68.1.20',
        })
      )
    ).toBe('203.0.113.9');
  });

  it('ignores forged Cloudflare headers from a non-Cloudflare peer', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': 'anything',
          'x-real-ip': '192.0.2.44',
        })
      )
    ).toBe('192.0.2.44');
  });

  it('accepts IPv4-mapped IPv6 peers and compressed IPv6 visitors', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'cf-connecting-ip': '2001:db8::1:2',
          'cf-ray': 'a509c917eae1b920-AMS',
          'x-real-ip': '::ffff:172.68.1.20',
        })
      )
    ).toBe('2001:db8::1:2');
  });
});

describe('getTrustedClientIdentifier', () => {
  it('uses the visitor address when request.ip is the Cloudflare peer', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWith({
      'cf-connecting-ip': '203.0.113.9',
      'cf-ray': 'a509c917eae1b920-AMS',
    });
    Object.defineProperty(request, 'ip', { value: '172.68.1.20' });
    expect(getTrustedClientIdentifier(request)).toBe('203.0.113.9');
  });

  it('keeps request.ip when it is not a Cloudflare peer', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWith({
      'cf-connecting-ip': '203.0.113.9',
      'cf-ray': 'anything',
    });
    Object.defineProperty(request, 'ip', { value: '192.0.2.44' });
    expect(getTrustedClientIdentifier(request)).toBe('192.0.2.44');
  });

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

  it('prefers cf-connecting-ip over the shared Cloudflare egress x-real-ip on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': 'a509c917eae1b920-AMS',
          'x-real-ip': '172.68.1.20',
        })
      )
    ).toBe('203.0.113.9');
  });

  it('ignores forged Cloudflare headers from a non-Cloudflare peer', () => {
    vi.stubEnv('VERCEL', '1');
    // Direct-to-origin callers can send cf-ray, but their platform
    // address is not a Cloudflare egress, so their chosen identity
    // must not replace the platform-verified address.
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': 'anything',
          'x-real-ip': '192.0.2.44',
        })
      )
    ).toBe('192.0.2.44');
  });

  it.each([
    // Just inside / outside 162.158.0.0/15 and 2a06:98c0::/29.
    ['162.159.255.255', '203.0.113.9'],
    ['162.160.0.0', '162.160.0.0'],
    ['2a06:98c7:ffff::1', '203.0.113.9'],
    ['2a06:98c8::1', '2a06:98c8::1'],
    ['::1', '::1'],
  ] as const)('resolves Cloudflare peer boundary %s', (peer, expected) => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': 'a509c917eae1b920-AMS',
          'x-real-ip': peer,
        })
      )
    ).toBe(expected);
  });

  it('does not trust cf-connecting-ip from a Cloudflare peer without cf-ray', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'x-real-ip': '172.68.1.20',
        })
      )
    ).toBe('172.68.1.20');
  });

  it('trusts cf-connecting-ip from a Cloudflare IPv6 peer', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': 'a509c917eae1b920-AMS',
          'x-real-ip': '2606:4700:4700::1111',
        })
      )
    ).toBe('203.0.113.9');
  });

  it('ignores cf-connecting-ip without evidence the request traversed Cloudflare', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'x-real-ip': '192.0.2.44',
        })
      )
    ).toBe('192.0.2.44');
  });

  it('ignores Cloudflare headers without a proxy guarantee and invalid values', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CART_TRUST_PROXY_HEADERS', '');
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': 'a509c917eae1b920-AMS',
        })
      )
    ).toBe('unknown');
    vi.stubEnv('VERCEL', '1');
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'cf-connecting-ip': 'not-an-ip',
          'cf-ray': 'a509c917eae1b920-AMS',
          'x-real-ip': '192.0.2.44',
        })
      )
    ).toBe('192.0.2.44');
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
