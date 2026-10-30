import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/cdn-image/[...path]/route';
import { proxy, config as proxyConfig } from '@/proxy';
import { toOgabasseySameOriginTransformUrl } from './ogabassey-same-origin-hero-url';

vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
  getSlugForCustomDomain: vi.fn().mockResolvedValue('ogabassey'),
}));

vi.mock('@/lib/reverse-domain-cache', () => ({
  isRecentlyUnmappedCustomDomain: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/storefront-product-slug-membership', () => ({
  resolveStorefrontProductSlugResolution: vi
    .fn()
    .mockResolvedValue({ kind: 'present-or-unknown' }),
}));

vi.mock('@/lib/storefront-product-canonical-redirect', () => ({
  getStorefrontProductCanonicalRedirectResult: vi
    .fn()
    .mockResolvedValue({ kind: 'unknown' }),
}));

const STATIC_ASSET_MATCHER_SOURCE =
  '/((?!_next/image(?:/.*[^/])?$|_next/static(?:/.*[^/])?$|manifest\\.webmanifest$|robots\\.txt$|ads\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff|woff2|ttf|eot|css|js|json)$|(?!favicon\\.ico$)(?!favicon\\.ico/$).+\\.ico$).*)';
const STATIC_ASSET_MATCHER_LITERAL_REGEX =
  /^\/((?!_next\/image(?:\/.*[^/])?$|_next\/static(?:\/.*[^/])?$|manifest\.webmanifest$|robots\.txt$|ads\.txt$|.*\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff|woff2|ttf|eot|css|js|json)$|(?!favicon\.ico$)(?!favicon\.ico\/$).+\.ico$).*)$/;
const RELAY_STATIC_MATCHER_LITERAL_REGEX =
  /^\/((?!_next\/static(?:\/|$))(?:.+\/)?(?:static|array)\/.*)$/;

function matchesProxyMatcher(pathname: string): boolean {
  return (
    pathname === '/agent-commerce.json' ||
    pathname === '/agent-trust.json' ||
    pathname === '/baci-relay' ||
    pathname.startsWith('/baci-relay/') ||
    RELAY_STATIC_MATCHER_LITERAL_REGEX.test(pathname) ||
    STATIC_ASSET_MATCHER_LITERAL_REGEX.test(pathname)
  );
}

async function resolveEffectiveCustomDomainPathname(
  pathname: string
): Promise<string> {
  if (!matchesProxyMatcher(pathname)) {
    return pathname;
  }
  const request = new NextRequest(`https://ogabassey.com${pathname}`, {
    headers: { host: 'ogabassey.com' },
  });
  const response = await proxy(request);
  const rewritten = response.headers.get('x-middleware-rewrite');
  return rewritten ? new URL(rewritten).pathname : pathname;
}

describe('toOgabasseySameOriginTransformUrl', () => {
  it('rewrites cdn.ogabassey.com transform URLs to /cdn-image/... while preserving non-CDN URLs', () => {
    expect(
      toOgabasseySameOriginTransformUrl(
        'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
      )
    ).toBe(
      '/cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
    );
    expect(
      toOgabasseySameOriginTransformUrl(
        '/cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
      )
    ).toBe(
      '/cdn-image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
    );
    expect(
      toOgabasseySameOriginTransformUrl('https://example.com/hero.jpg')
    ).toBe('https://example.com/hero.jpg');
  });

  it('returns the original URL when transform options, decoded asset path, or query string fail /cdn-image/ route validation', () => {
    const unsupportedOptionKey =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif,blur=10/core-assets/products/tecno.avif';
    expect(toOgabasseySameOriginTransformUrl(unsupportedOptionKey)).toBe(
      unsupportedOptionKey
    );

    const unsupportedBucket =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/other-bucket/tecno.avif';
    expect(toOgabasseySameOriginTransformUrl(unsupportedBucket)).toBe(
      unsupportedBucket
    );

    const unsupportedQuery =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif?token=secret';
    expect(toOgabasseySameOriginTransformUrl(unsupportedQuery)).toBe(
      unsupportedQuery
    );

    const duplicateVersionQuery =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif?v=1&v=2';
    expect(toOgabasseySameOriginTransformUrl(duplicateVersionQuery)).toBe(
      duplicateVersionQuery
    );
  });

  it('leaves uppercase or percent-encoded extensions on cdn.ogabassey.com and exercises custom-domain proxy routing for rewritten paths', async () => {
    expect(proxyConfig.matcher).toContain(STATIC_ASSET_MATCHER_SOURCE);

    const uppercaseUrl =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/phone.JPG';
    expect(toOgabasseySameOriginTransformUrl(uppercaseUrl)).toBe(uppercaseUrl);
    expect(
      await resolveEffectiveCustomDomainPathname(
        '/cdn-image/width=384,quality=70,format=avif/core-assets/products/phone.JPG'
      )
    ).toBe(
      '/ogabassey.com/cdn-image/width=384,quality=70,format=avif/core-assets/products/phone.JPG'
    );

    const encodedExtensionUrl =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/phone.%6A%70%67';
    expect(toOgabasseySameOriginTransformUrl(encodedExtensionUrl)).toBe(
      encodedExtensionUrl
    );

    for (const sourceUrl of [
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/phone.jpg',
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/static/phone.jpg',
    ]) {
      const rewritten = toOgabasseySameOriginTransformUrl(sourceUrl);
      expect(rewritten.startsWith('/cdn-image/')).toBe(true);
      const effectivePathname =
        await resolveEffectiveCustomDomainPathname(rewritten);
      expect(effectivePathname).toBe(rewritten);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new Uint8Array(12_000), {
          headers: { 'content-type': 'image/avif' },
          status: 200,
        })
      );
      try {
        const routeSegments = effectivePathname
          .slice('/cdn-image/'.length)
          .split('/')
          .map((segment) => decodeURIComponent(segment));
        const routeResponse = await GET(
          new NextRequest(`https://ogabassey.com${effectivePathname}`),
          { params: Promise.resolve({ path: routeSegments }) }
        );
        expect(routeResponse.status).toBe(200);
      } finally {
        fetchSpy.mockRestore();
      }
    }
  });
});
