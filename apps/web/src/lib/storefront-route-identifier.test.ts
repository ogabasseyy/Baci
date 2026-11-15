import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveMerchantContextIdentifier,
  resolveRouteIdentifier,
} from '@/lib/storefront-route-identifier';

function createHeaders(entries: [string, string][]) {
  return new Headers(entries) as unknown as Awaited<
    ReturnType<typeof import('next/headers').headers>
  >;
}

describe('resolveRouteIdentifier', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns an empty string when no host header exists', () => {
    expect(resolveRouteIdentifier(createHeaders([]))).toBe('');
  });

  it('prefers the custom domain header', () => {
    expect(
      resolveRouteIdentifier(
        createHeaders([
          ['x-custom-domain', 'Ogabassey.com'],
          ['x-merchant-slug', 'ignored'],
        ])
      )
    ).toBe('ogabassey.com');
  });

  it('falls back to the merchant slug header', () => {
    expect(
      resolveRouteIdentifier(createHeaders([['x-merchant-slug', 'Ogabassey']]))
    ).toBe('ogabassey');
  });

  it('falls back to the merchant domain header used by proxy rewrites', () => {
    expect(
      resolveRouteIdentifier(
        createHeaders([['x-merchant-domain', 'Ogabassey.com']])
      )
    ).toBe('ogabassey.com');
  });

  it('derives the slug from a root-domain subdomain host', () => {
    expect(
      resolveRouteIdentifier(
        createHeaders([['host', 'www.ogabassey.usebaci.com:3000']])
      )
    ).toBe('ogabassey');
  });

  it('returns the full host for external custom domains', () => {
    expect(
      resolveRouteIdentifier(createHeaders([['host', 'ogabassey.ng']]))
    ).toBe('ogabassey.ng');
  });

  it('returns an empty string for the bare root domain', () => {
    expect(
      resolveRouteIdentifier(createHeaders([['host', 'www.usebaci.com']]))
    ).toBe('');
  });

  it('returns an empty string for localhost development hosts', () => {
    expect(resolveRouteIdentifier(createHeaders([['host', 'localhost']]))).toBe(
      ''
    );
    expect(
      resolveRouteIdentifier(createHeaders([['host', 'localhost:3000']]))
    ).toBe('');
  });

  it('returns an empty string for loopback development hosts', () => {
    expect(resolveRouteIdentifier(createHeaders([['host', '127.0.0.1']]))).toBe(
      ''
    );
    expect(
      resolveRouteIdentifier(createHeaders([['host', '127.0.0.1:3000']]))
    ).toBe('');
  });

  it('trims NEXT_PUBLIC_ROOT_DOMAIN when resolving subdomains', () => {
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', '  custombaci.com  ');

    expect(
      resolveRouteIdentifier(
        createHeaders([['host', 'ogabassey.custombaci.com']])
      )
    ).toBe('ogabassey');
    expect(
      resolveRouteIdentifier(createHeaders([['host', 'custombaci.com']]))
    ).toBe('');
  });

  it('falls back to usebaci.com when NEXT_PUBLIC_ROOT_DOMAIN is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', '');

    expect(
      resolveRouteIdentifier(createHeaders([['host', 'ogabassey.usebaci.com']]))
    ).toBe('ogabassey');
  });
});

describe('resolveMerchantContextIdentifier', () => {
  it('prefers the custom domain header', () => {
    expect(
      resolveMerchantContextIdentifier(
        createHeaders([
          ['x-custom-domain', 'Ogabassey.com'],
          ['x-merchant-slug', 'ignored'],
        ])
      )
    ).toBe('ogabassey.com');
  });

  it('falls back to the merchant slug header', () => {
    expect(
      resolveMerchantContextIdentifier(
        createHeaders([['x-merchant-slug', 'Ogabassey']])
      )
    ).toBe('ogabassey');
  });

  it('falls back to the merchant domain header used by proxy rewrites', () => {
    expect(
      resolveMerchantContextIdentifier(
        createHeaders([['x-merchant-domain', 'Ogabassey.com']])
      )
    ).toBe('ogabassey.com');
  });

  it('ignores deployment hosts without merchant context headers', () => {
    expect(
      resolveMerchantContextIdentifier(
        createHeaders([['host', 'baci-preview.vercel.app']])
      )
    ).toBe('');
  });
});
