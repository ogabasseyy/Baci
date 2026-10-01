import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const { factory, resolver } = vi.hoisted(() => {
  const resolver = vi.fn().mockResolvedValue(null);
  return {
    factory: vi.fn(() => resolver),
    resolver,
  };
});

vi.mock('@/lib/storefront-compare-page-hard-status', () => ({
  createStorefrontComparePageHardStatusResolver: factory,
}));

import { storefrontRouteSegments } from '@/config/storefront-route-segments';
import { resolveStorefrontComparePageHardStatus } from './compare-preflight';
import {
  buildHardStatusStorefrontResponse,
  isEligibleForHardStatusPreflight,
} from './preflight-common';
import { getRouteType, getStorefrontContentSegments } from './routing-policy';

describe('compare preflight adapter', () => {
  it('wires the resolver to the proxy preflight policy and forwards navigation inputs', async () => {
    expect(factory).toHaveBeenCalledWith({
      isEligibleForHardStatusPreflight,
      getRouteType,
      getStorefrontContentSegments,
      nonCacheableStorefrontFirstSegments:
        storefrontRouteSegments.NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS,
      buildHardStatusStorefrontResponse,
    });

    const request = new NextRequest('https://shop.example/compare');
    await expect(
      resolveStorefrontComparePageHardStatus(
        request,
        '/compare',
        'shop.example',
        'Mozilla',
        'shop'
      )
    ).resolves.toBeNull();
    expect(resolver).toHaveBeenCalledWith(
      request,
      '/compare',
      'shop.example',
      'Mozilla',
      'shop'
    );
  });
});
