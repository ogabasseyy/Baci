import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as normalization from './path-normalization';
import {
  isPlatformSpecialRoutingEligible,
  runPlatformCanonicalRoutingStage,
  runPlatformRoutingStage,
} from './platform-routing';

describe('platform routing stages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('skips normalization work for canonical lowercase ASCII paths', () => {
    const cacheSafe = vi.spyOn(
      normalization,
      'normalizeCacheSafeStorefrontPathname'
    );
    const lowercase = vi.spyOn(normalization, 'lowercaseStorefrontPathname');
    expect(
      runPlatformCanonicalRoutingStage(
        new NextRequest('https://usebaci.com/products/iphone-15'),
        '/products/iphone-15',
        'usebaci.com'
      )
    ).toBeNull();
    expect(cacheSafe).not.toHaveBeenCalled();
    expect(lowercase).not.toHaveBeenCalled();
  });

  it.each([
    ['/phones/É', '/phones/%C3%A9'],
    ['/Phones/%2Fsafe?ref=email', '/phones/%2Fsafe?ref=email'],
    ['/phones/%E2%80%9Cpro%E2%80%9D', '/phones/pro'],
    ['/phones/%zz', null],
  ])('preserves canonicalization of %s', (input, expected) => {
    const response = runPlatformCanonicalRoutingStage(
      new NextRequest(`https://usebaci.com${input}`),
      input.split('?')[0],
      'usebaci.com'
    );
    expect(response?.headers.get('location') ?? null).toBe(
      expected === null ? null : `https://usebaci.com${expected}`
    );
    if (response) expect(response.status).toBe(308);
  });

  it('preserves well-known paths and marks them as special routing', async () => {
    const request = new NextRequest(
      'https://usebaci.com/.well-known/apple-app-site-association'
    );
    expect(
      isPlatformSpecialRoutingEligible(
        '/.well-known/apple-app-site-association',
        'usebaci.com'
      )
    ).toBe(true);
    expect(
      (
        await runPlatformRoutingStage(
          request,
          '/.well-known/apple-app-site-association',
          'usebaci.com',
          'Mozilla'
        )
      )?.headers.get('x-middleware-next')
    ).toBe('1');
  });

  it('canonicalizes mixed-case storefront documents but not API route case', () => {
    expect(
      runPlatformCanonicalRoutingStage(
        new NextRequest('https://usebaci.com/Phones/Iphone'),
        '/Phones/Iphone',
        'usebaci.com'
      )?.headers.get('location')
    ).toBe('https://usebaci.com/phones/iphone');
    expect(
      runPlatformCanonicalRoutingStage(
        new NextRequest('https://usebaci.com/API/Orders'),
        '/API/Orders',
        'usebaci.com'
      )
    ).toBeNull();
  });
});
