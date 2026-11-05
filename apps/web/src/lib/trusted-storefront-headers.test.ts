import { describe, expect, it } from 'vitest';
import {
  hasTrustedStorefrontHeaders,
  normalizeStorefrontHeader,
} from './trusted-storefront-headers';

function request(headers: Record<string, string>) {
  const normalizedHeaders = new Headers(headers);
  return { headers: normalizedHeaders };
}

describe('normalizeStorefrontHeader', () => {
  it('trims and lowercases values and treats blank values as absent', () => {
    expect(normalizeStorefrontHeader('  Shop.Example.COM  ')).toBe(
      'shop.example.com'
    );
    expect(normalizeStorefrontHeader('  ')).toBeUndefined();
    expect(normalizeStorefrontHeader(null)).toBeUndefined();
  });
});

describe('hasTrustedStorefrontHeaders', () => {
  it('accepts a matching custom domain and its www host', () => {
    expect(
      hasTrustedStorefrontHeaders(
        request({
          host: 'shop.example.com',
          'x-merchant-domain': 'shop.example.com',
        })
      )
    ).toBe(true);
    expect(
      hasTrustedStorefrontHeaders(
        request({
          host: 'www.shop.example.com',
          'x-merchant-domain': 'shop.example.com',
        })
      )
    ).toBe(true);
  });

  it('accepts merchant slug hosts on the root domain and localhost', () => {
    expect(
      hasTrustedStorefrontHeaders(
        request({ host: 'store.usebaci.com', 'x-merchant-slug': 'store' })
      )
    ).toBe(true);
    expect(
      hasTrustedStorefrontHeaders(
        request({ host: 'store.localhost:3000', 'x-merchant-slug': 'store' })
      )
    ).toBe(true);
  });

  it('rejects mismatched hosts, missing context, and root-host path aliases', () => {
    expect(
      hasTrustedStorefrontHeaders(
        request({
          host: 'shop.example.com',
          'x-merchant-domain': 'attacker.example',
        })
      )
    ).toBe(false);
    expect(
      hasTrustedStorefrontHeaders(
        request({ host: 'usebaci.com', 'x-merchant-slug': 'store' })
      )
    ).toBe(false);
    expect(
      hasTrustedStorefrontHeaders(request({ host: 'shop.example.com' }))
    ).toBe(false);
  });
});
