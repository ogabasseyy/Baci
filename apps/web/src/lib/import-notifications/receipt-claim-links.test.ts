// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  getRootDomain: vi.fn(() => 'usebaci.com'),
}));

import { isValidCustomDomain } from '@/lib/proxy/host';
import {
  buildReceiptClaimUrl,
  buildReceiptDeviceList,
  createReceiptClaimToken,
  hashReceiptClaimToken,
  isSafeClaimDomain,
  normalizeClaimEmail,
} from './receipt-claim-links';

describe('receipt claim links', () => {
  it('creates a lower-case URL-safe token and stores only a deterministic hash', () => {
    const bytes = new Uint8Array(32);
    bytes.fill(7);

    const claimToken = createReceiptClaimToken({ bytes });

    expect(claimToken.token).toMatch(/^[a-f0-9]+$/);
    expect(claimToken.token).not.toBe(claimToken.tokenHash);
    expect(claimToken.tokenHash).toBe(hashReceiptClaimToken(claimToken.token));
    expect(claimToken.tokenHash).toHaveLength(64);
  });

  it('builds custom-domain and subdomain receipt claim links', () => {
    expect(
      buildReceiptClaimUrl({
        merchant: {
          slug: 'ogabassey',
          custom_domain: 'ogabassey.com/',
        },
        token: 'token_123',
      })
    ).toBe('https://ogabassey.com/receipts/claim/token_123');

    expect(
      buildReceiptClaimUrl({
        merchant: {
          slug: 'future-merchant',
          custom_domain: null,
        },
        token: 'token_abc',
      })
    ).toBe('https://future-merchant.usebaci.com/receipts/claim/token_abc');
  });

  it('normalizes a trailing-dot absolute FQDN to the branded host', () => {
    expect(
      buildReceiptClaimUrl({
        merchant: { slug: 'ogabassey', custom_domain: 'Shop.Example.COM.' },
        token: 'token_123',
      })
    ).toBe('https://shop.example.com/receipts/claim/token_123');
  });

  it('falls back to the slug subdomain for malformed custom domains', () => {
    for (const custom_domain of [
      'evil.com/attacker',
      'user@evil.com',
      '10.0.0.1',
      'no-dot-hostname',
      'bad..dots.com',
      'shop.example.com:443',
    ]) {
      expect(
        buildReceiptClaimUrl({
          merchant: { slug: 'ogabassey', custom_domain },
          token: 'token_123',
        })
      ).toBe('https://ogabassey.usebaci.com/receipts/claim/token_123');
    }
  });

  it('throws for a host-unsafe slug instead of minting a broken link', () => {
    for (const slug of [
      '',
      ' ogabassey',
      'oga.bassey',
      'oga_bassey',
      '-ogabassey',
    ]) {
      expect(() =>
        buildReceiptClaimUrl({
          merchant: { slug, custom_domain: null },
          token: 'token_123',
        })
      ).toThrow('Invalid merchant slug for receipt claim URL');
    }
  });

  it('ignores an unsafe slug when the custom domain wins', () => {
    expect(
      buildReceiptClaimUrl({
        merchant: { slug: 'oga.bassey', custom_domain: 'ogabassey.com' },
        token: 'token_123',
      })
    ).toBe('https://ogabassey.com/receipts/claim/token_123');
  });

  it('does not add customer email hints to receipt claim links', () => {
    expect(
      buildReceiptClaimUrl({
        merchant: {
          slug: 'ogabassey',
          custom_domain: 'ogabassey.com',
        },
        token: 'token_123',
      })
    ).toBe('https://ogabassey.com/receipts/claim/token_123');
  });

  it('normalizes claim emails for grouping and idempotency', () => {
    expect(normalizeClaimEmail('  BasseyBJohn@Yahoo.CO.UK  ')).toBe(
      'basseybjohn@yahoo.co.uk'
    );
    expect(normalizeClaimEmail(null)).toBeNull();
    expect(normalizeClaimEmail(undefined)).toBeNull();
    expect(normalizeClaimEmail('')).toBeNull();
    expect(normalizeClaimEmail('   ')).toBeNull();
  });

  it('extracts readable device names from imported orders', () => {
    expect(
      buildReceiptDeviceList([
        {
          order_number: '06485',
          order_items: [
            { name: 'iPhone 16 Pro Max', quantity: 2 },
            { name: 'USB-C Charger', quantity: 1 },
          ],
        },
        {
          order_number: '06484',
          order_items: [{ name: 'iPhone 16 Pro Max', quantity: 1 }],
        },
        {
          order_number: '06483',
          order_items: [],
        },
      ])
    ).toEqual([
      '2 x iPhone 16 Pro Max',
      'USB-C Charger',
      'iPhone 16 Pro Max',
      'Receipt 06483',
    ]);
  });

  it('falls back to receipt labels when order items are null', () => {
    expect(
      buildReceiptDeviceList([
        {
          order_number: '06485',
          order_items: null,
        },
      ])
    ).toEqual(['Receipt 06485']);
  });

  it('handles nullable item names and quantities without throwing', () => {
    expect(
      buildReceiptDeviceList([
        {
          order_number: '06485',
          order_items: [
            { name: null, quantity: null },
            { name: '   ', quantity: 3 },
          ],
        },
      ])
    ).toEqual(['Receipt 06485', '3 x Receipt 06485']);
  });

  it('omits quantity prefixes for non-positive and single quantities', () => {
    expect(
      buildReceiptDeviceList([
        {
          order_number: '06485',
          order_items: [
            { name: 'iPhone 16 Pro Max', quantity: 0 },
            { name: 'AirPods Pro', quantity: -2 },
            { name: 'USB-C Charger', quantity: 1 },
          ],
        },
      ])
    ).toEqual(['iPhone 16 Pro Max', 'AirPods Pro', 'USB-C Charger']);
  });

  it('caps long device lists with an overflow summary', () => {
    const devices = buildReceiptDeviceList(
      Array.from({ length: 12 }, (_, index) => ({
        order_number: `ORD-${index + 1}`,
        order_items: [{ name: `Device ${index + 1}`, quantity: 1 }],
      })),
      4
    );

    expect(devices).toEqual([
      'Device 1',
      'Device 2',
      'Device 3',
      'Device 4',
      'and 8 more receipts',
    ]);
  });

  it('agrees with the proxy custom-domain rule on its shared core', () => {
    // The claim validator deliberately duplicates the proxy rule instead of
    // importing it (audited sender boundary); this pins the shared core so a
    // future proxy change fails loudly here rather than drifting silently.
    for (const host of [
      'shop.example.com',
      'store123.com',
      'my-shop.io',
      'a.b.c.example.co.uk',
    ]) {
      expect(isSafeClaimDomain(host)).toBe(true);
      expect(isValidCustomDomain(host)).toBe(true);
    }
    for (const host of [
      '10.0.0.1',
      'user@evil.com',
      'evil.com/attacker',
      'no-dot-hostname',
      'bad..dots.com',
      'has space.com',
      '-example.com',
    ]) {
      expect(isSafeClaimDomain(host)).toBe(false);
      expect(isValidCustomDomain(host)).toBe(false);
    }
  });

  it('pins the intentional claim-domain divergences from the proxy rule', () => {
    // Token URLs fail closed where the proxy is lenient with Host headers,
    // and normalize sloppy DB values the proxy (correctly) rejects.
    expect(isSafeClaimDomain('shop.example.com:443')).toBe(false);
    expect(isValidCustomDomain('shop.example.com:443')).toBe(true);
    for (const host of [
      'shop.example.com/',
      'shop.example.com.',
      '  shop.example.com  ',
    ]) {
      expect(isSafeClaimDomain(host)).toBe(true);
      expect(isValidCustomDomain(host)).toBe(false);
    }
    // Per-label strictness the proxy lacks: hyphen-terminated labels and
    // all-numeric TLDs fall back to the slug subdomain in token URLs.
    for (const host of ['example-.com', 'example.123']) {
      expect(isSafeClaimDomain(host)).toBe(false);
      expect(isValidCustomDomain(host)).toBe(true);
    }
  });
});
