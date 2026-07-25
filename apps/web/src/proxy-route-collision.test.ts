import { readdirSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSlugForCustomDomain } from '@/lib/domain-cache-simple';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { proxy } from './proxy';

// Self-contained mocks. This lives in its OWN file rather than proxy.test.ts so
// the persistent (non-`Once`) mock values the sweep needs cannot leak into that
// suite's 400+ ordered cases.
vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
  getSlugForCustomDomain: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn().mockResolvedValue({ response: undefined, user: null }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const CUSTOM_DOMAIN = 'ogabassey.com';
const MERCHANT_SLUG = 'zorvexa';

/**
 * Every live first URL segment under `(storefront)/[slug]`, read from the real
 * route tree at test time. Route groups are URL-transparent so the first REAL
 * segment is whatever sits beneath them; a dynamic segment in FIRST position is
 * per-merchant data that cannot be enumerated (documented accepted tradeoff in
 * proxy.ts), so that subtree is skipped — deeper dynamic segments simply inherit
 * the first segment already found.
 */
function collectLiveFirstSegments(
  dir: string,
  inheritedSegment: string | null
): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const isRouteGroup =
        entry.name.startsWith('(') && entry.name.endsWith(')');
      const isDynamic = entry.name.startsWith('[');
      if (isDynamic && inheritedSegment === null) {
        continue;
      }
      const segment = isRouteGroup
        ? inheritedSegment
        : (inheritedSegment ?? entry.name);
      found.push(
        ...collectLiveFirstSegments(path.join(dir, entry.name), segment)
      );
    } else if (
      inheritedSegment &&
      (entry.name === 'page.tsx' || entry.name === 'route.ts')
    ) {
      found.push(inheritedSegment);
    }
  }
  return found;
}

describe('bugfix: retired-slug prefix strip shadowed a live storefront route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not strip ANY live storefront first-segment used as a retired slug', async () => {
    const storefrontRoot = path.join(
      import.meta.dirname,
      'app',
      '(storefront)',
      '[slug]'
    );
    const liveSegments = [
      ...new Set(collectLiveFirstSegments(storefrontRoot, null)),
    ].sort();

    // Sanity: the walker must actually traverse the tree.
    expect(liveSegments.length).toBeGreaterThan(20);

    const stripped: string[] = [];
    for (const segment of liveSegments) {
      // Arrange: this merchant's RETIRED slug is literally the route name, so
      // the alias lookup would resolve to them — the live route must still win.
      vi.mocked(getSlugForCustomDomain).mockResolvedValue(MERCHANT_SLUG);
      vi.mocked(getCurrentSlugForAlias).mockResolvedValue(MERCHANT_SLUG);
      const request = new NextRequest(
        `https://${CUSTOM_DOMAIN}/${segment}/my-post`
      );
      request.headers.set('host', CUSTOM_DOMAIN);

      // Act
      const response = await proxy(request);

      // Assert (collected, so a failure names every offending segment at once)
      if (
        response.headers.get('location') === `https://${CUSTOM_DOMAIN}/my-post`
      ) {
        stripped.push(segment);
      }
    }

    // Anything listed here is a live route that a retired slug of the same name
    // would shadow — add it to RETIRED_SLUG_STRIP_LIVE_PAGE_SEGMENTS in
    // proxy.ts, the set this strip consults.
    expect(stripped).toEqual([]);
  });

  it('still strips a genuine retired slug that is NOT a live route', async () => {
    // Guard against over-reserving: the strip must keep working for real aliases.
    vi.mocked(getSlugForCustomDomain).mockResolvedValue(MERCHANT_SLUG);
    vi.mocked(getCurrentSlugForAlias).mockImplementation(
      async (slug: string) => (slug === 'yodhashop' ? MERCHANT_SLUG : null)
    );
    const request = new NextRequest(
      `https://${CUSTOM_DOMAIN}/yodhashop/summer-sale`
    );
    request.headers.set('host', CUSTOM_DOMAIN);

    const response = await proxy(request);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `https://${CUSTOM_DOMAIN}/summer-sale`
    );
  });
});

describe('reserving a route segment must not spill into unrelated proxy paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * `unlock-orders` belongs in NON_CACHEABLE_STOREFRONT_FIRST_SEGMENTS, NOT in
   * RESERVED_STOREFRONT_SEGMENTS. The reserved set additionally drives
   * merchant-slug validity, the metadata-cache partition, and the PDP
   * hard-404 / canonical-308 helpers, so reserving it there would penalise a
   * merchant or a product that legitimately carries that slug.
   */
  it('keeps the storefront-home CDN policy for a merchant slugged unlock-orders', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValue(null);
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue(null);
    const request = new NextRequest('https://usebaci.com/unlock-orders');
    request.headers.set('host', 'usebaci.com');

    const response = await proxy(request);

    // A reserved first segment makes isStorefrontHomeDocument reject the URL,
    // and the merchant loses its public cache headers entirely.
    expect(response.headers.get('cache-control')).not.toBe('no-store');
  });

  it('still rewrites the retired-alias API subtree for unlock-orders', async () => {
    // The live page owns the exact /unlock-orders path, never an /api subtree.
    // Excluding the prefix from the API branch would break stale same-origin
    // calls like custom.example/unlock-orders/api/storefront/customer.
    vi.mocked(getSlugForCustomDomain).mockResolvedValue(MERCHANT_SLUG);
    vi.mocked(getCurrentSlugForAlias).mockImplementation(
      async (slug: string) => (slug === 'unlock-orders' ? MERCHANT_SLUG : null)
    );
    const request = new NextRequest(
      `https://${CUSTOM_DOMAIN}/unlock-orders/api/storefront/customer`
    );
    request.headers.set('host', CUSTOM_DOMAIN);

    const response = await proxy(request);

    // A 302 here means it fell through to the page strip instead.
    expect(response.status).not.toBe(302);
  });

  it('still classifies a PDP whose CATEGORY is slugged unlock-orders', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValue(MERCHANT_SLUG);
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue(null);
    const request = new NextRequest(
      `https://${CUSTOM_DOMAIN}/unlock-orders/some-product`
    );
    request.headers.set('host', CUSTOM_DOMAIN);

    const response = await proxy(request);

    // NON_CACHEABLE membership would force no-store on a legitimate PDP.
    expect(response.headers.get('cache-control')).not.toBe('no-store');
  });

  it('still treats a PRODUCT slugged unlock-orders as a product URL', async () => {
    vi.mocked(getSlugForCustomDomain).mockResolvedValue(MERCHANT_SLUG);
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue(null);
    const request = new NextRequest(
      `https://${CUSTOM_DOMAIN}/products/unlock-orders`
    );
    request.headers.set('host', CUSTOM_DOMAIN);

    const response = await proxy(request);

    // The PDP helpers bail out early on a reserved second segment, which would
    // hand the request to the streamed App Router response they exist to avoid.
    expect(response.status).not.toBe(404);
  });
});
