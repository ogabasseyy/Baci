import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STOREFRONT_LCP_COPY_CSS } from '@/app/(storefront)/storefront-lcp-copy-css';
import {
  evaluateHeadJsGuard,
  evaluateHomepageHtmlGuard,
  evaluateRouteCssGuard,
} from './evaluate-storefront-cwv-guards';
import { STOREFRONT_CWV_GUARD_BUDGETS } from './storefront-cwv-guard-budgets';

const WEB_SRC = path.resolve(process.cwd(), 'src');

function countCssImports(relativeFilePath: string): number {
  const source = readFileSync(path.join(WEB_SRC, relativeFilePath), 'utf8');
  return [...source.matchAll(/^\s*import\s+['"][^'"]+\.css['"]/gm)].length;
}

describe('storefront CWV regression guards — current main baseline', () => {
  it('passes current homepage HTML structure and counts only inline RSC script bytes', () => {
    const rscScriptBody = 'self.__next_f.push([1,"chunk"])';
    const sampleCurrentHomeHtml = `<!DOCTYPE html><html><head>
      <script src="/_next/static/chunks/main.js" async></script>
      <link rel="preload" as="image" imageSrcSet="https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/hero.avif 384w, https://cdn.ogabassey.com/image/width=640,quality=70,format=avif/core-assets/products/hero.avif 640w" imageSizes="(max-width: 767px) 40vw, 1px" fetchPriority="high"/>
      <link rel="preload" as="image" href="https://cdn.ogabassey.com/image/width=960,quality=70,format=avif/core-assets/products/hero.avif" imageSrcSet="https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/hero.avif 384w" imageSizes="(max-width: 767px) 40vw, 1px" fetchPriority="high" data-ogabassey-home-hero-preload="true"/>
    </head><body>
      <picture><template id="B:6"></template><img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" fetchpriority="high" alt="Hero"/></picture>
      <div hidden id="S:6"><source type="image/avif" srcset="https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/hero.avif 384w"/></div>
      <script>${rscScriptBody}</script>
    </body></html>`;

    const result = evaluateHomepageHtmlGuard(sampleCurrentHomeHtml);
    expect(result.passed).toBe(true);
    expect(result.headImagePreloads).toBe(2);
    expect(result.heroInsideHiddenSuspense).toBe(true);
    expect(result.hasDataGifHeroSrc).toBe(true);
    expect(result.inlineRscBytes).toBe(
      Buffer.byteLength(rscScriptBody, 'utf8')
    );
  });

  it('enforces current route CSS budgets against storefront route sources', () => {
    const listingLayoutSource = readFileSync(
      path.join(
        WEB_SRC,
        'app/(storefront)/[slug]/(catalog)/(listing)/layout.tsx'
      ),
      'utf8'
    );
    const brandAuthoritySource = readFileSync(
      path.join(
        WEB_SRC,
        'app/(storefront)/[slug]/(catalog)/(listing)/[category]/brands/[brandSlug]/brand-authority-page-content.tsx'
      ),
      'utf8'
    );
    const pdpCssCount = countCssImports(
      'app/(storefront)/[slug]/(catalog)/(pdp)/[category]/[productSlug]/page.tsx'
    );
    const blogPostLayoutCssCount = countCssImports(
      'app/(storefront)/[slug]/(blog)/blog/[postSlug]/layout.tsx'
    );

    expect(
      evaluateRouteCssGuard({
        route: 'category',
        stylesheetCount: 2,
        criticalCss: STOREFRONT_LCP_COPY_CSS,
        listingLayoutSource,
      }).passed
    ).toBe(true);

    expect(
      evaluateRouteCssGuard({
        route: 'brandHub',
        stylesheetCount: 2,
        brandAuthoritySource,
      }).passed
    ).toBe(true);

    expect(
      evaluateRouteCssGuard({
        route: 'pdp',
        stylesheetCount: pdpCssCount,
      }).passed
    ).toBe(true);

    expect(
      evaluateRouteCssGuard({
        route: 'blogPost',
        stylesheetCount: blogPostLayoutCssCount,
      }).passed
    ).toBe(true);
  });
});

describe('storefront CWV regression guards — fail-closed enforcement', () => {
  it('flags preload count, hidden Suspense split, data:image/gif src, and disallowed origin across srcset candidates', () => {
    const violatingHtml = `<!DOCTYPE html><html><head>
      <link rel="preload" as="image" imageSrcSet="https://ogabassey.com/image/width=384,quality=70/hero.avif 384w, https://untrusted.example.com/hero.avif 640w"/>
      <link rel="preload" as="image" href="https://ogabassey.com/hero.avif"/>
    </head><body>
      <picture><img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" srcset="https://ogabassey.com/other.avif 384w" fetchpriority="high"/></picture>
      <div hidden id="S:6"><div class="wrapper"><source srcset="https://ogabassey.com/hero.avif 384w"/></div></div>
      <script>self.__next_f.push([1,"${'x'.repeat(200)}"])</script>
    </body></html>`;

    const result = evaluateHomepageHtmlGuard(violatingHtml, {
      allowedHeroOrigins: ['https://ogabassey.com'],
      forbidDataGifHeroSrc: true,
      maxHeadImagePreloads: 1,
      maxHtmlBytes: 100,
      maxInlineRscBytes: 50,
      requireHeroOutsideHiddenSuspense: true,
      requirePreloadMatchesImgSrcSet: true,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('HTML size'),
        expect.stringContaining('Inline RSC size'),
        expect.stringContaining('Head image preload count 2 exceeds budget 1'),
        'Hero <picture>/<source> found inside hidden Suspense slot',
        'Hero <img> uses data:image/gif placeholder src',
        'Disallowed hero image origin in URL: https://untrusted.example.com/hero.avif',
        'Expected exactly 1 head image preload, found 2',
      ])
    );
  });

  it('passes ratcheted H1/H2/H4 homepage contract when single preload and synchronous picture match', () => {
    const cleanHtml = `<!DOCTYPE html><html><head>
      <link rel="preload" as="image" imageSrcSet="/cdn-image/width=384,quality=60,format=avif/core-assets/products/hero.avif 384w" imageSizes="(max-width: 767px) 40vw, 1px" fetchPriority="high"/>
    </head><body>
      <picture>
        <source type="image/avif" srcset="/cdn-image/width=384,quality=60,format=avif/core-assets/products/hero.avif 384w"/>
        <img src="/cdn-image/width=384,quality=60,format=avif/core-assets/products/hero.avif" srcset="/cdn-image/width=384,quality=60,format=avif/core-assets/products/hero.avif 384w" fetchpriority="high" alt="Hero"/>
      </picture>
    </body></html>`;

    const result = evaluateHomepageHtmlGuard(cleanHtml, {
      ...STOREFRONT_CWV_GUARD_BUDGETS.homepageHtml,
      allowedHeroOrigins: ['https://ogabassey.com'],
      forbidDataGifHeroSrc: true,
      maxHeadImagePreloads: 1,
      requireHeroOutsideHiddenSuspense: true,
      requirePreloadMatchesImgSrcSet: true,
    });

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('flags ZodError, GoTrueClient, RealtimeClient, script count, and brotli size in head JS', () => {
    const headHtml = `<html><head>
      <script src="/_next/static/chunks/a.js" async></script>
      <script src="/_next/static/chunks/b.js" async></script>
      <script src="/_next/static/chunks/missing.js" async></script>
    </head><body></body></html>`;

    const result = evaluateHeadJsGuard(
      {
        html: headHtml,
        chunkContents: {
          '/_next/static/chunks/a.js': {
            brotliBytes: 40_000,
            raw: 'class ZodError extends Error {}',
          },
          '/_next/static/chunks/b.js': {
            brotliBytes: 50_000,
            raw: 'class GoTrueClient {} class RealtimeClient {}',
          },
        },
      },
      {
        forbiddenChunkTokens: ['ZodError', 'GoTrueClient', 'RealtimeClient'],
        maxAsyncScriptCount: 1,
        maxTotalBrotliBytes: 60_000,
      }
    );

    expect(result.passed).toBe(false);
    expect(result.forbiddenMatches).toEqual([
      { chunkUrl: '/_next/static/chunks/a.js', token: 'ZodError' },
      { chunkUrl: '/_next/static/chunks/b.js', token: 'GoTrueClient' },
      { chunkUrl: '/_next/static/chunks/b.js', token: 'RealtimeClient' },
    ]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        'Head script /_next/static/chunks/missing.js has no chunk content; cannot verify tokens or size',
        'Head script count 3 exceeds budget 1',
        'Head JS brotli total 90000B exceeds budget 60000B',
      ])
    );
  });

  it('fails closed on missing CSS inputs, missing footer lock, StorefrontFullStyleLoader, and missing authority-hub lock', () => {
    const result = evaluateRouteCssGuard(
      {
        route: 'category',
        listingLayoutSource: '<StorefrontFullStyleLoader />',
      },
      {
        forbidListingFullStyleLoader: true,
        maxRenderBlockingStylesheets: {
          ...STOREFRONT_CWV_GUARD_BUDGETS.css.maxRenderBlockingStylesheets,
          category: 2,
        },
        requireAuthorityHubLcpCopyLock: true,
        requireFooterLockInCriticalCss: true,
      }
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      'Route "category" CSS check requires stylesheetCount or html',
      'Critical inline CSS is missing .ogabassey-mobile-footer { position: fixed } lock',
      '(listing)/layout.tsx still references StorefrontFullStyleLoader',
      'BrandAuthorityPageContent is missing data-cwv-lcp-copy="authority-hub"',
    ]);
  });
});
