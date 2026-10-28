import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OgabasseyHomeHeroPreloadLink } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-preload-link';
import { STOREFRONT_LCP_COPY_CSS } from '@/app/(storefront)/storefront-lcp-copy-css';
import { HeroDesktopGrid } from '@/components/storefront/ogabassey/components/hero-desktop-grid';
import { MobileLcpHeroImage } from '@/components/storefront/ogabassey/components/mobile-lcp-hero-image';
import {
  evaluateHeadJsGuard,
  evaluateHomepageHtmlGuard,
  evaluateRouteCssGuard,
  evaluateStorefrontSourceCssGuards,
  loadHeadChunkContentsFromBuildDir,
} from './evaluate-storefront-cwv-guards';
import { STOREFRONT_CWV_GUARD_BUDGETS } from './storefront-cwv-guard-budgets';

const WEB_SRC = path.resolve(process.cwd(), 'src');
const HERO_SLIDE_URL =
  'https://cdn.ogabassey.com/core-assets/products/hero-test.jpg';

describe('storefront CWV regression guards — real storefront components & sources', () => {
  it('evaluates real rendered OgabasseyHomeHeroPreloadLink, MobileLcpHeroImage, and HeroDesktopGrid markup', () => {
    const headMarkup = renderToStaticMarkup(
      createElement(OgabasseyHomeHeroPreloadLink, { src: HERO_SLIDE_URL })
    );
    const bodyMarkup = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(MobileLcpHeroImage, {
          alt: 'Test Phone',
          imageFit: 'contain',
          shouldPrioritizeImage: true,
          src: HERO_SLIDE_URL,
        }),
        createElement(HeroDesktopGrid, {
          slides: [
            {
              ctaLabel: 'Shop now',
              href: '/smartphones/test-phone',
              id: 'slide-1',
              imageAlt: 'Test Phone',
              imageUrl: HERO_SLIDE_URL,
              name: 'Test Phone',
              priceLabel: '₦500,000',
            },
          ],
        })
      )
    );
    const rscScriptBody = 'self.__next_f.push([1,"chunk"])';
    const fullHtml = `<!DOCTYPE html><html><head>${headMarkup}</head><body>${bodyMarkup}<script>${rscScriptBody}</script></body></html>`;

    const result = evaluateHomepageHtmlGuard(fullHtml);
    expect(result.passed).toBe(true);
    expect(result.headImagePreloads).toBe(1);
    expect(result.hasDataGifHeroSrc).toBe(true);
    expect(result.inlineRscBytes).toBe(
      Buffer.byteLength(rscScriptBody, 'utf8')
    );
  });

  it('enforces current route CSS budgets by reading actual storefront route source files', () => {
    const evaluations = evaluateStorefrontSourceCssGuards(
      WEB_SRC,
      STOREFRONT_LCP_COPY_CSS
    );

    expect(evaluations.home.passed).toBe(true);
    expect(evaluations.home.stylesheetCount).toBe(2);
    expect(evaluations.category.passed).toBe(true);
    expect(evaluations.category.stylesheetCount).toBe(2);
    expect(evaluations.brandHub.passed).toBe(true);
    expect(evaluations.brandHub.stylesheetCount).toBe(2);
    expect(evaluations.pdp.passed).toBe(true);
    expect(evaluations.pdp.stylesheetCount).toBe(4);
    expect(evaluations.blogPost.passed).toBe(true);
    expect(evaluations.blogPost.stylesheetCount).toBe(3);
  });

  it('loads real head chunk files and brotli sizes from a .next build directory', () => {
    const tempNextDir = mkdtempSync(path.join(tmpdir(), 'cwv-next-build-'));
    try {
      const chunksDir = path.join(tempNextDir, 'static', 'chunks');
      mkdirSync(chunksDir, { recursive: true });
      writeFileSync(
        path.join(chunksDir, 'entry.js'),
        'console.log("clean head chunk");',
        'utf8'
      );
      const html =
        '<html><head><script src="/_next/static/chunks/entry.js?dpl=1" async></script></head><body></body></html>';
      const chunkContents = loadHeadChunkContentsFromBuildDir(
        html,
        tempNextDir
      );
      const guard = evaluateHeadJsGuard({ chunkContents, html });
      expect(guard.passed).toBe(true);
      expect(guard.asyncScriptCount).toBe(1);
      expect(guard.totalBrotliBytes).toBeGreaterThan(0);
    } finally {
      rmSync(tempNextDir, { force: true, recursive: true });
    }
  });
});

describe('storefront CWV regression guards — fail-closed enforcement', () => {
  it('flags preload count, flipped-order hidden Suspense split, picture source origin, and disallowed relative origin', () => {
    const violatingHtml = `<!DOCTYPE html><html><head>
      <link rel="preload" as="image" imageSrcSet="https://ogabassey.com/image/width=384,quality=70/hero.avif 384w"/>
      <link rel="preload" as="image" href="/cdn-image/hero.avif"/>
    </head><body>
      <picture>
        <source type="image/avif" srcset="https://untrusted.example.com/hero.avif 384w"/>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" srcset="https://ogabassey.com/other.avif 384w" fetchpriority="high"/>
      </picture>
      <div id="S:6" hidden><div class="wrapper"><source srcset="https://ogabassey.com/hero.avif 384w"/></div></div>
      <script>self.__next_f.push([1,"${'x'.repeat(200)}"])</script>
    </body></html>`;

    const result = evaluateHomepageHtmlGuard(violatingHtml, {
      allowedHeroOrigins: ['https://cdn.ogabassey.com'],
      baseOrigin: 'https://ogabassey.com',
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
        'Disallowed hero image origin in URL: /cdn-image/hero.avif',
        'Disallowed hero image origin in URL: https://untrusted.example.com/hero.avif',
        'Expected exactly 1 head image preload, found 2',
      ])
    );
  });

  it('fails closed when no hero <img> with fetchpriority="high" exists and allows relative URLs on baseOrigin', () => {
    const missingHeroHtml =
      '<!DOCTYPE html><html><head></head><body><img src="/images/hero.avif"/></body></html>';
    expect(evaluateHomepageHtmlGuard(missingHeroHtml).failures).toContain(
      'No hero <img> with fetchpriority="high" found'
    );

    const cleanHtml = `<!DOCTYPE html><html><head>
      <link rel="preload" as="image" imageSrcSet="/images/hero.avif 384w" imageSizes="(max-width: 767px) 40vw, 1px" fetchPriority="high"/>
    </head><body>
      <picture>
        <source type="image/avif" srcset="/images/hero.avif 384w"/>
        <img src="/images/hero.avif" srcset="/images/hero.avif 384w" fetchpriority="high" alt="Hero"/>
      </picture>
    </body></html>`;

    const result = evaluateHomepageHtmlGuard(cleanHtml, {
      ...STOREFRONT_CWV_GUARD_BUDGETS.homepageHtml,
      allowedHeroOrigins: ['https://ogabassey.com'],
      baseOrigin: 'https://ogabassey.com',
      forbidDataGifHeroSrc: true,
      maxHeadImagePreloads: 1,
      requireHeroOutsideHiddenSuspense: true,
      requirePreloadMatchesImgSrcSet: true,
    });
    expect(result.passed).toBe(true);
  });

  it('counts only async head scripts and ignores non-head chunks in chunkContents', () => {
    const headHtml = `<html><head>
      <script src="/_next/static/chunks/a.js" async></script>
      <script src="/_next/static/chunks/b.js" async=""></script>
      <script src="/_next/static/chunks/missing.js" async></script>
      <script src="/_next/static/chunks/async-helper.js"></script>
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
            raw: 'class GoTrueClient {}',
          },
          '/_next/static/chunks/lazy-body.js': {
            brotliBytes: 99_000,
            raw: 'class RealtimeClient {}',
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
    expect(result.asyncScriptCount).toBe(3);
    expect(result.totalBrotliBytes).toBe(90_000);
    expect(result.forbiddenMatches).toEqual([
      { chunkUrl: '/_next/static/chunks/a.js', token: 'ZodError' },
      { chunkUrl: '/_next/static/chunks/b.js', token: 'GoTrueClient' },
    ]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        'Head script /_next/static/chunks/missing.js has no chunk content; cannot verify tokens or size',
        'Head script count 3 exceeds budget 1',
        'Head JS brotli total 90000B exceeds budget 60000B',
      ])
    );
  });

  it('excludes print/disabled stylesheets and scopes footer/listing/authority locks to their routes', () => {
    const ratchetedCssBudget = {
      forbidListingFullStyleLoader: true,
      maxRenderBlockingStylesheets: {
        ...STOREFRONT_CWV_GUARD_BUDGETS.css.maxRenderBlockingStylesheets,
        pdp: 2,
      },
      requireAuthorityHubLcpCopyLock: true,
      requireFooterLockInCriticalCss: true,
    };

    const pdpWithPrintSheet = evaluateRouteCssGuard(
      {
        html: `<html><head>
          <link rel="stylesheet" href="/a.css"/>
          <link rel="stylesheet" href="/styles/disabled.css"/>
          <link rel="stylesheet" href="/print.css" media="print"/>
          <link rel="stylesheet" href="/other.css" disabled/>
        </head><body></body></html>`,
        route: 'pdp',
      },
      ratchetedCssBudget
    );
    expect(pdpWithPrintSheet.passed).toBe(true);
    expect(pdpWithPrintSheet.stylesheetCount).toBe(2);

    const failingBrandHub = evaluateRouteCssGuard(
      {
        brandAuthoritySource: '<header><p>Intro</p></header>',
        listingLayoutSource: '<StorefrontFullStyleLoader />',
        route: 'brandHub',
      },
      ratchetedCssBudget
    );
    expect(failingBrandHub.passed).toBe(false);
    expect(failingBrandHub.failures).toEqual([
      'Route "brandHub" CSS check requires stylesheetCount or html',
      'Critical inline CSS is missing .ogabassey-mobile-footer { position: fixed } lock',
      '(listing)/layout.tsx still references StorefrontFullStyleLoader',
      'BrandAuthorityPageContent is missing data-cwv-lcp-copy="authority-hub"',
    ]);
  });
});
