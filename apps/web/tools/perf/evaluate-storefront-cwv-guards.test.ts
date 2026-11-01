import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  } & Record<string, unknown>) =>
    createElement('a', { href, ...rest }, children),
}));

vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/image')>();
  return { ...actual };
});

import { OgabasseyHomeCriticalShell } from '@/app/(storefront)/ogabassey/ogabassey-home-critical-shell';
import { OgabasseyHomeHeroPreloadLink } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-preload-link';
import { STOREFRONT_LCP_COPY_CSS } from '@/app/(storefront)/storefront-lcp-copy-css';
import { Hero } from '@/components/storefront/ogabassey/components/Hero';
import {
  countStorefrontRouteCssImports,
  evaluateHeadJsGuard,
  evaluateHomepageHtmlGuard,
  evaluateRouteCssGuard,
  evaluateStorefrontSourceCssGuards,
  loadHeadChunkContentsFromBuildDir,
} from './evaluate-storefront-cwv-guards';
import { STOREFRONT_CWV_GUARD_BUDGETS } from './storefront-cwv-guard-budgets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, '../../src');
const SAMPLE_HERO_URL =
  'https://cdn.ogabassey.com/core-assets/products/iphone-16-pro-max.avif';

describe('evaluate-storefront-cwv-guards', () => {
  it('passes against real rendered OgaBassey homepage shell, preload link, and full Hero (mobile + desktop grid)', () => {
    const preloadHtml = renderToStaticMarkup(
      createElement(OgabasseyHomeHeroPreloadLink, {
        src: SAMPLE_HERO_URL,
      })
    );
    const bodyHtml = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(OgabasseyHomeCriticalShell),
        createElement(
          'main',
          null,
          createElement(Hero, {
            omitDocumentHeading: true,
            prioritizeMobileHeroImage: true,
            slides: [
              {
                ctaLabel: 'Shop now',
                href: '/ogabassey/smartphones/iphone-16-pro-max',
                id: 'slide-1',
                imageAlt: 'iPhone 16 Pro Max',
                imageUrl: SAMPLE_HERO_URL,
                kind: 'product',
                name: 'iPhone 16 Pro Max',
                priceLabel: '₦1,800,000',
              },
            ],
          })
        )
      )
    );
    const fullHtml = `<!DOCTYPE html><html lang="en"><head>${preloadHtml}</head><body>${bodyHtml}</body></html>`;
    expect(bodyHtml).toContain('data-ogabassey-mobile-hero="true"');
    expect(bodyHtml).toContain('data-ogabassey-desktop-hero="true"');
    expect(bodyHtml.match(/fetchPriority="high"/gi)).toHaveLength(2);
    const result = evaluateHomepageHtmlGuard(fullHtml);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.headImagePreloads).toBe(1);
    expect(result.hasDataGifHeroSrc).toBe(false);
    expect(result.heroInsideHiddenSuspense).toBe(false);
    expect(result.heroUrls.length).toBeGreaterThan(0);
    expect(
      STOREFRONT_CWV_GUARD_BUDGETS.homepageHtml.maxHtmlBytes
    ).toBeLessThanOrEqual(325_000);
    expect(
      STOREFRONT_CWV_GUARD_BUDGETS.homepageHtml.maxInlineRscBytes
    ).toBeLessThanOrEqual(190_000);
  });

  it('passes real storefront CSS source guards for all 5 monitored routes at current baseline', () => {
    const evaluations = evaluateStorefrontSourceCssGuards(
      WEB_SRC_DIR,
      STOREFRONT_LCP_COPY_CSS
    );
    expect(evaluations.home.passed).toBe(true);
    expect(evaluations.home.stylesheetCount).toBe(0);
    expect(evaluations.category.passed).toBe(true);
    expect(evaluations.category.stylesheetCount).toBe(2);
    expect(evaluations.brandHub.passed).toBe(true);
    expect(evaluations.brandHub.stylesheetCount).toBe(2);
    expect(evaluations.pdp.passed).toBe(true);
    expect(evaluations.pdp.stylesheetCount).toBe(4);
    expect(evaluations.blogPost.passed).toBe(true);
    expect(evaluations.blogPost.stylesheetCount).toBe(3);
    expect(countStorefrontRouteCssImports('pdp', WEB_SRC_DIR)).toBe(4);
  });

  it('rejects untrusted or cross-origin <source srcset> inside <picture> when only same-origin ogabassey.com is allowed', () => {
    const htmlWithUntrustedPictureSource = [
      '<!DOCTYPE html><html><head>',
      '<link rel="preload" as="image" imageSrcSet="/cdn-image/hero.avif 640w"/>',
      '</head><body>',
      '<picture>',
      '<source type="image/avif" srcset="https://untrusted.example.com/hero.avif 384w"/>',
      '<source srcset="https://cdn.ogabassey.com/image/hero.jpg 384w"/>',
      '<img src="/cdn-image/hero.jpg" fetchpriority="high"/>',
      '</picture>',
      '<picture>',
      '<source type="image/avif" srcset="https://below-fold.example.com/card.avif 384w"/>',
      '<img src="https://below-fold.example.com/card.jpg" loading="lazy"/>',
      '</picture>',
      '</body></html>',
    ].join('');

    const result = evaluateHomepageHtmlGuard(htmlWithUntrustedPictureSource);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      'Disallowed hero image origin in URL: https://untrusted.example.com/hero.avif'
    );
    expect(result.failures).toContain(
      'Disallowed hero image origin in URL: https://cdn.ogabassey.com/image/hero.jpg'
    );
    expect(result.failures).not.toContain(
      'Disallowed hero image origin in URL: https://below-fold.example.com/card.avif'
    );
  });

  it('catches homepage HTML regressions when ratcheted budgets are violated', () => {
    const badHtml = [
      '<!DOCTYPE html><html><head>',
      '<link rel="preload" as="image" href="https://cdn.ogabassey.com/a.avif" imageSrcSet="https://cdn.ogabassey.com/a.avif 640w"/>',
      '<link rel="preload" as="image" href="https://cdn.ogabassey.com/b.avif" imageSrcSet="https://cdn.ogabassey.com/b.avif 640w"/>',
      '</head><body>',
      '<picture><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" fetchpriority="high"/></picture>',
      '<div id="S:6" hidden><source srcset="https://evil.example.com/a.avif 640w"/></div>',
      '<script>self.__next_f.push([1,"x"])</script>',
      '</body></html>',
    ].join('');

    const result = evaluateHomepageHtmlGuard(badHtml, {
      ...STOREFRONT_CWV_GUARD_BUDGETS.homepageHtml,
      forbidDataGifHeroSrc: true,
      maxHeadImagePreloads: 1,
      maxHtmlBytes: 100,
      maxInlineRscBytes: 5,
      requireHeroOutsideHiddenSuspense: true,
      requirePreloadMatchesImgSrcSet: true,
    });

    expect(result.passed).toBe(false);
    expect(result.headImagePreloads).toBe(2);
    expect(result.heroInsideHiddenSuspense).toBe(true);
    expect(result.hasDataGifHeroSrc).toBe(true);

    const hrefOnlyPreloadHtml = [
      '<!DOCTYPE html><html><head>',
      '<link rel="preload" as="image" href="https://cdn.ogabassey.com/a.avif"/>',
      '</head><body>',
      '<picture><img src="https://cdn.ogabassey.com/a.avif" fetchpriority="high"/></picture>',
      '</body></html>',
    ].join('');
    const hrefOnlyResult = evaluateHomepageHtmlGuard(hrefOnlyPreloadHtml);
    expect(hrefOnlyResult.passed).toBe(false);
    expect(hrefOnlyResult.failures).toContain(
      'Head preload imageSrcSet does not match hero img srcset'
    );
  });

  it('loads real brotli chunk sizes from a build directory and fails closed on missing or forbidden chunks', () => {
    const tempBuildDir = mkdtempSync(path.join(tmpdir(), 'cwv-build-'));
    try {
      const chunksDir = path.join(tempBuildDir, 'static/chunks');
      mkdirSync(chunksDir, { recursive: true });
      writeFileSync(
        path.join(chunksDir, 'clean.js'),
        'console.log("clean storefront runtime");',
        'utf8'
      );
      const html =
        '<html><head><script src="/_next/static/chunks/clean.js?dpl=1" async></script><script src="/_next/static/chunks/inline.js" data-mode="async"></script></head><body></body></html>';
      const chunkContents = loadHeadChunkContentsFromBuildDir(
        html,
        tempBuildDir
      );
      const cleanEval = evaluateHeadJsGuard({ chunkContents, html });
      expect(cleanEval.passed).toBe(true);
      expect(cleanEval.asyncScriptCount).toBe(1);

      const forbiddenEval = evaluateHeadJsGuard({
        chunkContents: {
          '/_next/static/chunks/clean.js?dpl=1': {
            brotliBytes: 42,
            raw: 'new GoTrueClient({ url: "https://example.supabase.co" })',
          },
        },
        html,
      });
      expect(forbiddenEval.passed).toBe(false);
      expect(forbiddenEval.forbiddenMatches).toEqual([
        {
          chunkUrl: '/_next/static/chunks/clean.js?dpl=1',
          token: 'GoTrueClient',
        },
      ]);

      const missingEval = evaluateHeadJsGuard({ chunkContents: {}, html });
      expect(missingEval.passed).toBe(false);
    } finally {
      rmSync(tempBuildDir, { force: true, recursive: true });
    }
  });

  it('excludes non-render-blocking stylesheets and scopes CSS locks to their target routes', () => {
    const htmlWithPrintSheet = [
      '<html><head>',
      '<link rel="stylesheet" href="/a.css"/>',
      '<link rel="stylesheet" href="/print.css" media="print"/>',
      '<link rel="stylesheet" href="/disabled.css" disabled/>',
      '</head><body></body></html>',
    ].join('');
    const pdpWithRatchets = evaluateRouteCssGuard(
      { html: htmlWithPrintSheet, route: 'pdp' },
      {
        ...STOREFRONT_CWV_GUARD_BUDGETS.css,
        forbidListingFullStyleLoader: true,
        requireAuthorityHubLcpCopyLock: true,
      }
    );
    expect(pdpWithRatchets.passed).toBe(true);
    expect(pdpWithRatchets.stylesheetCount).toBe(1);

    const listingFail = evaluateRouteCssGuard(
      {
        brandAuthoritySource: '<p>Unmarked intro</p>',
        criticalCss: 'body { margin: 0; }',
        listingLayoutSource: '<StorefrontFullStyleLoader />',
        route: 'brandHub',
        stylesheetCount: 3,
      },
      {
        ...STOREFRONT_CWV_GUARD_BUDGETS.css,
        forbidListingFullStyleLoader: true,
        requireAuthorityHubLcpCopyLock: true,
        requireFooterLockInCriticalCss: true,
      }
    );
    expect(listingFail.passed).toBe(false);
    expect(listingFail.failures).toHaveLength(4);
  });
});
