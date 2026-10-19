import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  isEligibleForHardStatusPreflight,
  resolveUnsafeStorefrontPdpPath,
} from './preflight-common';

describe('shared storefront preflight guards', () => {
  it('limits hard status reads to anonymous document GETs', () => {
    expect(
      isEligibleForHardStatusPreflight(
        new NextRequest('https://shop.example/products/iphone', {
          headers: { accept: 'text/html' },
        }),
        '/products/iphone'
      )
    ).toBe(true);
    expect(
      isEligibleForHardStatusPreflight(
        new NextRequest('https://shop.example/products/iphone', {
          method: 'POST',
        }),
        '/products/iphone'
      )
    ).toBe(false);
  });

  it('returns a terminal 404 for an unsafe overlong PDP slug', () => {
    const slug = 'a'.repeat(513);
    expect(
      resolveUnsafeStorefrontPdpPath(
        new NextRequest(`https://shop.example/products/${slug}`),
        `/products/${slug}`,
        'shop.example',
        'Mozilla'
      )?.status
    ).toBe(404);
  });
});
