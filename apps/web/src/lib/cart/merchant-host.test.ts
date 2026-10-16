import { describe, expect, it } from 'vitest';

import {
  isPrivateLanHost,
  isSharedPlatformHost,
  normalizeHeader,
  normalizeHost,
  requestHost,
} from './merchant-host';

describe('normalizeHost', () => {
  it('lowercases and strips ports from DNS and IPv4 hosts', () => {
    expect(normalizeHost('Shop.Example.com:8443')).toBe('shop.example.com');
    expect(normalizeHost(' 192.168.1.20:3000 ')).toBe('192.168.1.20');
    expect(normalizeHost(null)).toBe('');
  });

  it('keeps bracketed IPv6 literals intact, with or without a port', () => {
    expect(normalizeHost('[::1]:3000')).toBe('[::1]');
    expect(normalizeHost('[2001:DB8::1]')).toBe('[2001:db8::1]');
  });

  it('returns malformed bracketed values unchanged for anchored rejection', () => {
    expect(normalizeHost('[::1')).toBe('[::1');
  });
});

describe('requestHost', () => {
  it('prefers the Host header over the request URL', () => {
    const request = new Request('https://fallback.example/cart', {
      headers: { host: 'Tenant.Example.com:443' },
    });
    expect(requestHost(request)).toBe('tenant.example.com');
  });

  it('falls back to the URL hostname when no Host header is present', () => {
    const request = new Request('https://api.example.com:8443/cart');
    // The runtime may synthesize a Host header from the URL; either way
    // the port must not leak into tenant resolution.
    expect(requestHost(request)).toBe('api.example.com');
  });
});

describe('normalizeHeader', () => {
  it('trims, lowercases, and nulls empty values', () => {
    expect(normalizeHeader(' Merchant ')).toBe('merchant');
    expect(normalizeHeader('   ')).toBeNull();
    expect(normalizeHeader(null)).toBeNull();
  });
});

describe('isPrivateLanHost', () => {
  it('accepts loopback and RFC1918 ranges', () => {
    for (const host of [
      '::1',
      '[::1]',
      '10.0.0.5',
      '192.168.1.20',
      '172.16.0.1',
      '172.31.255.255',
    ])
      expect(isPrivateLanHost(host)).toBe(true);
  });

  it('rejects public and look-alike hosts', () => {
    for (const host of [
      '172.32.0.1',
      '8.8.8.8',
      '10.0.0.5.evil.example',
      '192.168.1.20.example',
      'localhost',
      '',
    ])
      expect(isPrivateLanHost(host)).toBe(false);
  });
});

describe('isSharedPlatformHost', () => {
  const root = 'usebaci.com';

  it('accepts platform, api, staging, and local development hosts', () => {
    for (const host of [
      root,
      `www.${root}`,
      `api.${root}`,
      `api-staging.${root}`,
      'localhost',
      '127.0.0.1',
      '192.168.1.20',
      '[::1]',
    ])
      expect(isSharedPlatformHost(host, root)).toBe(true);
  });

  it('rejects tenant and look-alike hosts', () => {
    for (const host of [
      `shop.${root}`,
      `evil${root}`,
      `api.${root}.evil.example`,
      'example.com',
      '',
    ])
      expect(isSharedPlatformHost(host, root)).toBe(false);
  });
});
