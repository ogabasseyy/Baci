import { createRequire } from 'node:module';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import rawNextConfig from './next.config';
import { STOREFRONT_METADATA_CACHE_BUCKET_HEADER } from './src/config/storefront-metadata-cache-bots';

const require = createRequire(import.meta.url);
const { pathToRegexp } = require('next/dist/compiled/path-to-regexp') as {
  pathToRegexp: (path: string) => RegExp;
};
const { compileNonPath } =
  require('next/dist/shared/lib/router/utils/prepare-destination') as {
    compileNonPath: (value: string, params: Record<string, string>) => string;
  };
const OGABASSEY_DOCUMENT_HOST_MATCHER = '(?:www\\.)?ogabassey\\.com';

type NextConfigFunction = (
  phase: string,
  context: { defaultConfig: NextConfig }
) => NextConfig | Promise<NextConfig>;

type ResolvableNextConfig = NextConfig | NextConfigFunction;

function resolveNextConfig(config: ResolvableNextConfig): Promise<NextConfig> {
  if (typeof config === 'function') {
    return Promise.resolve(
      config(PHASE_PRODUCTION_BUILD, { defaultConfig: {} })
    );
  }

  return Promise.resolve(config);
}

describe('next.config OgaBassey Link headers', () => {
  let nextConfig: NextConfig;

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    nextConfig = await resolveNextConfig(rawNextConfig as ResolvableNextConfig);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('advertises a media-CDN preconnect on generic OgaBassey Link headers (Ops-2 Early Hints)', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();

    const ogabasseyLinkHeader = headers
      ?.find(
        (entry) =>
          !entry.source.includes(':productSlug') &&
          JSON.stringify(entry.has) ===
            JSON.stringify([
              { type: 'host', value: OGABASSEY_DOCUMENT_HOST_MATCHER },
            ])
      )
      ?.headers.find((header) => header.key === 'Link')?.value;

    // preconnect (safe, no wasteful fetch) is emitted so Cloudflare can replay it
    // as a 103 Early Hint; the responsive image PRELOAD stays excluded (below).
    expect(ogabasseyLinkHeader).toContain(
      '<https://cdn.ogabassey.com>; rel=preconnect'
    );
    expect(ogabasseyLinkHeader).toContain(
      '</.well-known/api-catalog>; rel="api-catalog"'
    );
    const hostMatcher = new RegExp(`^${OGABASSEY_DOCUMENT_HOST_MATCHER}$`);
    expect(hostMatcher.test('ogabassey.com')).toBe(true);
    expect(hostMatcher.test('www.ogabassey.com')).toBe(true);
    expect(hostMatcher.test('shop.ogabassey.com')).toBe(false);
  });

  it('advertises agent discovery resources in OgaBassey Link headers', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();

    const ogabasseyLinkHeader = headers
      ?.find(
        (entry) =>
          !entry.source.includes(':productSlug') &&
          JSON.stringify(entry.has) ===
            JSON.stringify([
              { type: 'host', value: OGABASSEY_DOCUMENT_HOST_MATCHER },
            ])
      )
      ?.headers.find((header) => header.key === 'Link')?.value;

    expect(ogabasseyLinkHeader).toContain(
      '</.well-known/api-catalog>; rel="api-catalog"'
    );
    expect(ogabasseyLinkHeader).toContain(
      '</.well-known/agent-skills/index.json>; rel="service-meta"'
    );
    expect(ogabasseyLinkHeader).toContain(
      '</.well-known/mcp/server-card.json>; rel="service-desc"'
    );
    expect(ogabasseyLinkHeader).toContain('</auth.md>; rel="service-doc"');
  });

  it('keeps PDP LCP image preload hints out of global HTML headers', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();

    const globalHtmlHeaderRule = headers.find(
      (entry) =>
        entry.source.startsWith('/((?!api') &&
        entry.headers.some(
          (header) =>
            header.key === 'Vary' &&
            header.value.includes(STOREFRONT_METADATA_CACHE_BUCKET_HEADER)
        )
    );
    expect(globalHtmlHeaderRule).toBeDefined();
    const globalHeaderValues =
      globalHtmlHeaderRule?.headers.map((header) => header.value).join('\n') ??
      '';
    expect(globalHeaderValues).not.toContain('/api/ogabassey/pdp-lcp-image/');
  });

  it('keeps PDP LCP image preload headers off generic OgaBassey routes', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();
    expect(headers).toBeDefined();

    const ogabasseyGenericHeaderRule = headers.find(
      (entry) =>
        !entry.source.includes(':productSlug') &&
        JSON.stringify(entry.has) ===
          JSON.stringify([
            { type: 'host', value: OGABASSEY_DOCUMENT_HOST_MATCHER },
          ])
    );
    expect(ogabasseyGenericHeaderRule).toBeDefined();
    const linkHeader = ogabasseyGenericHeaderRule?.headers.find(
      (header) => header.key === 'Link'
    )?.value;

    expect(linkHeader).toContain(
      '</.well-known/api-catalog>; rel="api-catalog"'
    );
    expect(linkHeader).not.toContain('/api/ogabassey/pdp-lcp-image/');
  });

  it('emits the media-CDN preconnect but keeps PDP image PRELOADS out of HTTP Link headers', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();
    expect(headers).toBeDefined();

    const ogabasseyPdpHeaderRule = headers.find(
      (entry) =>
        entry.source.includes(':productSlug') &&
        JSON.stringify(entry.has) ===
          JSON.stringify([
            { type: 'host', value: OGABASSEY_DOCUMENT_HOST_MATCHER },
          ])
    );

    expect(ogabasseyPdpHeaderRule).toBeDefined();
    const linkHeader = ogabasseyPdpHeaderRule?.headers.find(
      (header) => header.key === 'Link'
    )?.value;

    expect(linkHeader).toContain(
      '</.well-known/api-catalog>; rel="api-catalog"'
    );
    // preconnect IS present (Ops-2); a responsive image preload is NOT.
    expect(linkHeader).toContain('<https://cdn.ogabassey.com>; rel=preconnect');
    expect(linkHeader).not.toContain('/api/ogabassey/pdp-lcp-image/');
    expect(linkHeader).not.toContain('/profile/mobile-header/');
    expect(linkHeader).not.toContain('/profile/mobile/');
  });

  it('keeps interpolated PDP Link headers free of image preload URL parameters', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();
    expect(headers).toBeDefined();

    const ogabasseyPdpHeaderRule = headers.find(
      (entry) =>
        entry.source.includes(':productSlug') &&
        JSON.stringify(entry.has) ===
          JSON.stringify([
            { type: 'host', value: OGABASSEY_DOCUMENT_HOST_MATCHER },
          ])
    );
    const linkHeader = ogabasseyPdpHeaderRule?.headers.find(
      (header) => header.key === 'Link'
    )?.value;

    expect(typeof linkHeader).toBe('string');
    const productSlug = 'lenovo-legion-pro-9-16irx9-rtx-4090';
    const compiledLinkHeader = compileNonPath(linkHeader ?? '', {
      productSlug,
    });

    expect(compiledLinkHeader).not.toContain('/api/ogabassey/pdp-lcp-image/');
    expect(compiledLinkHeader).not.toContain('/profile/mobile-header/');
    expect(compiledLinkHeader).not.toContain('/profile/mobile/');
    expect(compiledLinkHeader).not.toContain(`${productSlug}width=`);
    expect(compiledLinkHeader).not.toContain(':productSlug?');
  });

  it('keeps the generic OgaBassey Link header from overriding PDP paths', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();
    expect(headers).toBeDefined();

    const ogabasseyHostMatcher = JSON.stringify([
      { type: 'host', value: OGABASSEY_DOCUMENT_HOST_MATCHER },
    ]);
    const pdpRuleIndex = headers.findIndex(
      (entry) =>
        entry.source.includes(':productSlug') &&
        JSON.stringify(entry.has) === ogabasseyHostMatcher
    );
    const genericRuleIndex = headers.findIndex(
      (entry) =>
        !entry.source.includes(':productSlug') &&
        JSON.stringify(entry.has) === ogabasseyHostMatcher
    );

    expect(pdpRuleIndex).toBeGreaterThanOrEqual(0);
    expect(genericRuleIndex).toBeGreaterThanOrEqual(0);
    expect(genericRuleIndex).toBeLessThan(pdpRuleIndex);
    const pdpPath = '/gaming-laptops/lenovo-legion-pro-9-16irx9-rtx-4090';
    expect(
      pathToRegexp(headers[pdpRuleIndex]?.source ?? '').test(pdpPath)
    ).toBe(true);
    expect(
      pathToRegexp(headers[genericRuleIndex]?.source ?? '').test(pdpPath)
    ).toBe(false);

    const matchingPdpLinkHeaders = headers
      .filter(
        (entry) =>
          JSON.stringify(entry.has) === ogabasseyHostMatcher &&
          entry.headers.some((header) => header.key === 'Link') &&
          pathToRegexp(entry.source).test(pdpPath)
      )
      .map((entry) => entry.headers.find((header) => header.key === 'Link'))
      .map((header) => header?.value)
      .filter((value): value is string => typeof value === 'string');

    expect(matchingPdpLinkHeaders).toHaveLength(1);
    const firstMatchingPdpLinkHeader = matchingPdpLinkHeaders[0];

    expect(firstMatchingPdpLinkHeader).toContain(
      '</.well-known/api-catalog>; rel="api-catalog"'
    );
    expect(firstMatchingPdpLinkHeader).not.toContain(
      '/api/ogabassey/pdp-lcp-image/'
    );
  });

  it('limits route-scoped OgaBassey PDP preload headers to two-segment PDP paths', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const headers = await nextConfig.headers();
    expect(headers).toBeDefined();

    const ogabasseyPdpHeaderRule = headers.find(
      (entry) =>
        entry.source.includes(':productSlug') &&
        JSON.stringify(entry.has) ===
          JSON.stringify([
            { type: 'host', value: OGABASSEY_DOCUMENT_HOST_MATCHER },
          ])
    );

    expect(ogabasseyPdpHeaderRule).toBeDefined();
    expect(ogabasseyPdpHeaderRule?.source).toContain(
      ':productSlug([a-zA-Z0-9-]+)'
    );
    expect(ogabasseyPdpHeaderRule?.source).not.toContain('.*');

    const pdpHeaderMatcher = pathToRegexp(ogabasseyPdpHeaderRule?.source ?? '');
    expect(
      pdpHeaderMatcher.test(
        '/gaming-laptops/lenovo-legion-pro-9-16irx9-rtx-4090'
      )
    ).toBe(true);
    expect(pdpHeaderMatcher.test('/about/company')).toBe(false);
    expect(pdpHeaderMatcher.test('/about/nested/route')).toBe(false);
    expect(pdpHeaderMatcher.test('/gaming-laptops/bad;slug')).toBe(false);
    expect(pdpHeaderMatcher.test('/gaming-laptops/bad>slug')).toBe(false);
  });
});
