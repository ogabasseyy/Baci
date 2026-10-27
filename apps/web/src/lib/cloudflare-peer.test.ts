import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isCloudflarePeer,
  normalizedClientIp,
  platformPeerIp,
  verifiedCloudflareVisitorIp,
  visitorQuotaIdentity,
} from './cloudflare-peer';

afterEach(() => vi.unstubAllEnvs());

function requestWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/storefront/cart', {
    headers,
  });
}

describe('isCloudflarePeer', () => {
  it.each([
    // Just inside / outside 162.158.0.0/15 and 2a06:98c0::/29.
    ['162.159.255.255', true],
    ['162.160.0.0', false],
    ['2a06:98c7:ffff::1', true],
    ['2a06:98c8::1', false],
    ['::1', false],
    ['172.68.1.20', true],
    ['192.0.2.44', false],
    ['2606:4700:4700::1111', true],
    // IPv4-mapped peers are judged by the embedded IPv4 address.
    ['::ffff:172.68.1.20', true],
    ['::ffff:192.0.2.44', false],
    ['not-an-ip', false],
  ] as const)('resolves peer boundary %s', (peer, expected) => {
    expect(isCloudflarePeer(peer)).toBe(expected);
  });
});

describe('normalizedClientIp', () => {
  it('unwraps IPv4-mapped forms and leaves real addresses intact', () => {
    expect(normalizedClientIp('::ffff:172.68.1.20')).toBe('172.68.1.20');
    expect(normalizedClientIp('2001:db8::1:2')).toBe('2001:db8::1:2');
    expect(normalizedClientIp('203.0.113.9')).toBe('203.0.113.9');
  });
});

describe('visitorQuotaIdentity', () => {
  it('buckets IPv6 visitors by /64 so identifier rotation cannot reset budgets', () => {
    expect(visitorQuotaIdentity('2001:db8::1:2')).toBe('2001:db8:0:0::/64');
    expect(visitorQuotaIdentity('2001:db8::9:9')).toBe('2001:db8:0:0::/64');
    expect(visitorQuotaIdentity('203.0.113.9')).toBe('203.0.113.9');
    expect(visitorQuotaIdentity('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });
});

describe('platformPeerIp', () => {
  it('uses the x-vercel-forwarded-for last hop on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      platformPeerIp(
        requestWith({ 'x-vercel-forwarded-for': '203.0.113.9, 172.68.1.20' }),
        true
      )
    ).toBe('172.68.1.20');
  });

  it('ignores x-vercel-forwarded-for off Vercel even with proxy headers allowed', () => {
    // The header is platform-set only on Vercel; under a self-hosted
    // trusted-proxy assertion it stays client-suppliable, so a forged
    // Cloudflare-egress hop must not become peer evidence.
    vi.stubEnv('VERCEL', '');
    expect(
      platformPeerIp(
        requestWith({ 'x-vercel-forwarded-for': '203.0.113.9, 172.68.1.20' }),
        true
      )
    ).toBeNull();
  });
});

describe('verifiedCloudflareVisitorIp', () => {
  it('returns the visitor address only behind a Cloudflare peer with cf-ray', () => {
    const request = requestWith({
      'cf-connecting-ip': '2001:db8::1:2',
      'cf-ray': 'a509c917eae1b920-AMS',
    });
    expect(verifiedCloudflareVisitorIp(request, '172.68.1.20')).toBe(
      '2001:db8::1:2'
    );
    expect(verifiedCloudflareVisitorIp(request, '192.0.2.44')).toBeNull();
    expect(verifiedCloudflareVisitorIp(request, null)).toBeNull();
  });
});
