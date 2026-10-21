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

describe('getClientIdentifier header trust', () => {
  it('prefers the platform connection IP when present', () => {
    const req = requestWith({
      'x-forwarded-for': '1.1.1.1',
      'x-real-ip': '2.2.2.2',
      'x-vercel-forwarded-for': '3.3.3.3',
    });
    Object.defineProperty(req, 'ip', { value: '9.9.9.9' });

    expect(getClientIdentifier(req)).toBe('9.9.9.9');
  });

  it('prefers x-vercel-forwarded-for over x-real-ip and x-forwarded-for on Vercel', () => {
    // x-vercel-forwarded-for survives a proxy stacked on top of Vercel,
    // where x-forwarded-for may be rewritten; on plain Vercel all three
    // carry the same edge-verified client IP.
    vi.stubEnv('VERCEL', '1');

    expect(
      getClientIdentifier(
        requestWith({
          'x-forwarded-for': '1.1.1.1',
          'x-real-ip': '2.2.2.2',
          'x-vercel-forwarded-for': '3.3.3.3',
        })
      )
    ).toBe('3.3.3.3');
  });

  it('ignores x-vercel-forwarded-for off Vercel', () => {
    // Off Vercel the header is client-mintable per request, so it must
    // not outrank the other signals as a rotation vector.
    vi.stubEnv('VERCEL', '');

    expect(
      getClientIdentifier(
        requestWith({
          'x-forwarded-for': '1.1.1.1',
          'x-real-ip': '2.2.2.2',
          'x-vercel-forwarded-for': '3.3.3.3',
        })
      )
    ).toBe('2.2.2.2');
  });

  it('resolves chains to the final entry only, never an earlier one', () => {
    // Every earlier entry is client-supplied: scanning back past an
    // invalid final entry would let an attacker choose its own bucket
    // with a '<chosen-ip>, garbage' chain. An invalid final entry falls
    // through to the next signal instead (fail-closed).
    expect(
      getClientIdentifier(
        requestWith({ 'x-forwarded-for': '198.51.100.9, 203.0.113.5' })
      )
    ).toBe('203.0.113.5');
    expect(
      getClientIdentifier(
        requestWith({ 'x-forwarded-for': 'not-an-ip, 203.0.113.6' })
      )
    ).toBe('203.0.113.6');
    expect(
      getClientIdentifier(
        requestWith({ 'x-forwarded-for': '203.0.113.6, not-an-ip' })
      )
    ).toBe('unknown');
    // Trailing commas/whitespace are benign proxy formatting, not an
    // attacker bucket-selection attempt, so they resolve to the final IP.
    expect(
      getClientIdentifier(requestWith({ 'x-forwarded-for': '198.51.100.9, ' }))
    ).toBe('198.51.100.9');
  });

  it('tolerates padded single-value headers and reports unknown otherwise', () => {
    expect(
      getClientIdentifier(requestWith({ 'x-real-ip': '  7.7.7.7  ' }))
    ).toBe('7.7.7.7');
    expect(getClientIdentifier(requestWith({}))).toBe('unknown');
    expect(
      getClientIdentifier(requestWith({ 'x-forwarded-for': 'not-an-ip' }))
    ).toBe('unknown');
  });

  it('accepts every compressed IPv6 shape, including groups on both sides of ::', () => {
    // A regex alternation cannot cover every compression; these must all
    // validate or v6 shoppers pool into 'unknown'.
    for (const ip of [
      '2001:0db8:0000:0000:0000:0000:0000:0001',
      '2001:db8:85a3::8a2e:370:7334',
      '2001:db8::1',
      '::1',
      'fe80::',
      '2001:db8::',
    ]) {
      expect(getClientIdentifier(requestWith({ 'x-real-ip': ip }))).toBe(ip);
    }
  });

  it('rejects malformed IPv6 without pooling valid neighbors', () => {
    for (const ip of [
      '1:::2',
      '1::2::3',
      '1:2:3:4:5:6:7:8:9',
      'gggg::1',
      '::ffff:1.2.3.4',
      '2001:db8:85a3:8a2e:370:7334',
    ]) {
      expect(getClientIdentifier(requestWith({ 'x-real-ip': ip }))).toBe(
        'unknown'
      );
    }
  });
});

describe('Cloudflare distrust', () => {
  it('never trusts CF-Connecting-IP, even behind Cloudflare egress', () => {
    // Peer-in-egress-ranges proves only Cloudflare's network, not this
    // deployment's zone, and Worker subrequests carry Worker-controlled
    // CF-Connecting-IP — trusting it would let any free Worker rotate
    // every per-IP limit globally. Shoppers behind one egress share a
    // bucket instead (accepted residual, tracked in #3751).
    vi.stubEnv('VERCEL', '1');
    const headers = {
      'x-forwarded-for': '172.64.0.1',
      'x-real-ip': '172.64.0.1',
      'x-vercel-forwarded-for': '172.64.0.1',
      'cf-connecting-ip': '198.51.100.9',
    };

    expect(getClientIdentifier(requestWith(headers))).toBe('172.64.0.1');
    expect(getTrustedClientIdentifier(requestWith(headers))).toBe('172.64.0.1');
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

  it('prefers x-vercel-forwarded-for on Vercel, like the lenient identifier', () => {
    // A proxy stacked on top of Vercel may rewrite x-forwarded-for while
    // the Vercel header still carries the edge-verified client IP; both
    // identifiers must agree there or the proxy and durable budget layers
    // measure different callers.
    vi.stubEnv('VERCEL', '1');
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'x-forwarded-for': '198.51.100.9',
          'x-real-ip': '192.0.2.1',
          'x-vercel-forwarded-for': '203.0.113.7',
        })
      )
    ).toBe('203.0.113.7');
    expect(
      getClientIdentifier(
        requestWith({
          'x-forwarded-for': '198.51.100.9',
          'x-real-ip': '192.0.2.1',
          'x-vercel-forwarded-for': '203.0.113.7',
        })
      )
    ).toBe('203.0.113.7');
  });

  it('ignores x-vercel-forwarded-for off Vercel', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CART_TRUST_PROXY_HEADERS', '');
    expect(
      getTrustedClientIdentifier(
        requestWith({ 'x-vercel-forwarded-for': '203.0.113.7' })
      )
    ).toBe('unknown');
  });
});
