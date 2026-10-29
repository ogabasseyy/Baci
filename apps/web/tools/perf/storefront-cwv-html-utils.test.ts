import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countCssImportsInSource,
  countStorefrontRouteCssImports,
  extractAsyncHeadScriptUrls,
  extractAttribute,
  extractHeadSection,
  extractHiddenSuspenseSections,
  extractImagePreloadTags,
  getInlineRscBytes,
  hasBooleanAttribute,
  isAllowedHeroUrl,
  parseSrcSetUrls,
} from './storefront-cwv-html-utils';

describe('storefront-cwv-html-utils', () => {
  it('extracts head section and image preload tags', () => {
    const html =
      '<html><head><link rel="preload" as="image" href="/a.avif"/><link rel="stylesheet" href="/b.css"/></head><body></body></html>';
    const head = extractHeadSection(html);
    expect(extractImagePreloadTags(head)).toEqual([
      '<link rel="preload" as="image" href="/a.avif"/>',
    ]);
  });

  it('extracts hidden Suspense sections regardless of attribute order or nesting', () => {
    const html =
      '<div id="S:1" hidden><div class="inner"><source srcset="/a.avif 640w"/></div></div>';
    expect(extractHiddenSuspenseSections(html)).toEqual([
      '<div class="inner"><source srcset="/a.avif 640w"/></div>',
    ]);
  });

  it('parses comma+whitespace srcset URLs without splitting transform commas', () => {
    const srcSet =
      'https://cdn.ogabassey.com/image/width=256,quality=70,format=avif/a.avif 256w, https://cdn.ogabassey.com/image/width=640,quality=70,format=avif/a.avif 640w';
    expect(parseSrcSetUrls(srcSet)).toEqual([
      'https://cdn.ogabassey.com/image/width=256,quality=70,format=avif/a.avif',
      'https://cdn.ogabassey.com/image/width=640,quality=70,format=avif/a.avif',
    ]);
  });

  it('detects boolean attributes and ignores tokens inside quoted attribute values', () => {
    expect(
      hasBooleanAttribute('<script src="/a.js" async></script>', 'async')
    ).toBe(true);
    expect(
      hasBooleanAttribute(
        '<script src="/a.js" data-mode="async loader"></script>',
        'async'
      )
    ).toBe(false);
    expect(
      extractAsyncHeadScriptUrls(
        '<script src="/a.js" async></script><script src="/b.js" data-mode="async"></script>'
      )
    ).toEqual(['/a.js']);
    expect(extractAttribute('<img src="/hero.avif" alt="Hero"/>', 'src')).toBe(
      '/hero.avif'
    );
    expect(
      extractAttribute(
        '<img data-src="/wrong.avif" src="/hero.avif" alt="Hero"/>',
        'src'
      )
    ).toBe('/hero.avif');
    expect(
      extractAttribute('<img data-src="/wrong.avif" alt="Hero"/>', 'src')
    ).toBeNull();
  });

  it('validates hero URLs against allowed origins and rejects dangerous schemes', () => {
    const allowed = ['https://ogabassey.com', 'https://cdn.ogabassey.com'];
    expect(isAllowedHeroUrl('/cdn-image/hero.avif', allowed)).toBe(true);
    expect(
      isAllowedHeroUrl('https://cdn.ogabassey.com/hero.avif', allowed)
    ).toBe(true);
    expect(isAllowedHeroUrl('javascript:alert(1)', allowed)).toBe(false);
    expect(
      isAllowedHeroUrl('https://evil.example.com/hero.avif', allowed)
    ).toBe(false);
  });

  it('counts side-effect, default, named, and namespace static CSS imports while ignoring deferred dynamic imports', () => {
    const source = [
      "import './critical.css';",
      "import styles from './card.module.css';",
      "import { shell } from './shell.css';",
      "import * as theme from './theme.css';",
      "void import('./deferred.css');",
    ].join('\n');
    expect(countCssImportsInSource(source)).toBe(4);
  });

  it('follows transitive local module and directory barrel imports when counting storefront route CSS imports', () => {
    const tempSrcDir = mkdtempSync(path.join(tmpdir(), 'cwv-css-src-'));
    try {
      const listingDir = path.join(tempSrcDir, 'app/(storefront)/nested');
      mkdirSync(listingDir, { recursive: true });
      writeFileSync(
        path.join(
          tempSrcDir,
          'app/(storefront)/storefront-eager-listing-css-layout.tsx'
        ),
        [
          "import '@/app/(storefront)/storefront-core.css';",
          "import { ChildStyles } from './nested';",
          'export function StorefrontEagerListingCssLayout() { return ChildStyles(); }',
        ].join('\n'),
        'utf8'
      );
      writeFileSync(
        path.join(listingDir, 'index.ts'),
        "export { GrandChildStyles as ChildStyles } from './grandchild-styles';",
        'utf8'
      );
      writeFileSync(
        path.join(listingDir, 'grandchild-styles.ts'),
        [
          "import './extra-listing.css';",
          'export function GrandChildStyles() { return null; }',
        ].join('\n'),
        'utf8'
      );
      expect(countStorefrontRouteCssImports('category', tempSrcDir)).toBe(2);
    } finally {
      rmSync(tempSrcDir, { force: true, recursive: true });
    }
  });

  it('computes inline Next.js RSC Flight byte size', () => {
    const html =
      '<script>self.__next_f.push([1,"hello"])</script><script>console.log(1)</script>';
    expect(getInlineRscBytes(html)).toBe(
      Buffer.byteLength('self.__next_f.push([1,"hello"])', 'utf8')
    );
  });
});
