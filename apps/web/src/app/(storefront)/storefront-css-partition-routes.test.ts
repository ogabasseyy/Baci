import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readStorefrontFile } from './storefront-css-partition-read';
import { STOREFRONT_LCP_COPY_CSS } from './storefront-lcp-copy-css';

describe('storefront CSS partitioning (route sheets)', () => {
  it.each([
    'storefront-home.css',
    'storefront-pdp.css',
    'storefront-listing.css',
    'storefront-blog.css',
    'storefront-utility.css',
    'storefront-content.css',
    'storefront-not-found.css',
  ])('includes the shared consent prompt and button dependency closure in %s before it mounts', (file) => {
    const content = readStorefrontFile(file);
    expect(content).toContain(
      '@source "../../components/storefront/cookie-consent.tsx";'
    );
    expect(content).toContain(
      '@source "../../components/themed/themed-button.tsx";'
    );
    expect(content).toContain('@source "../../components/ui/button.tsx";');
  });

  it('keeps blog-post additive over the blog sheet consent closure', () => {
    // [postSlug]/layout.tsx always imports storefront-blog.css (which owns
    // the cookie-consent + themed-button + ui/button closure) immediately
    // before storefront-blog-post.css, so the delta sheet must not re-emit
    // those utilities.
    const content = readStorefrontFile('storefront-blog-post.css');
    expect(content).not.toContain('components/storefront/cookie-consent.tsx');
    expect(content).not.toContain('components/themed/themed-button.tsx');
    expect(content).not.toContain('components/ui/button.tsx');
  });

  it.each([
    'storefront-listing.css',
    'storefront-content.css',
    'storefront-utility.css',
  ])('includes the shared layout chrome in %s for semantic footer reservations', (file) => {
    expect(readStorefrontFile(file)).toContain(
      '@source "../../components/storefront/ogabassey/storefront-layout-chrome.tsx";'
    );
  });

  it('loads OgaBassey below-fold PDP styles through the deferred PDP stylesheet', () => {
    const deferredPdpCss = readStorefrontFile(
      'storefront-ogabassey-pdp-deferred.css'
    );

    expect(deferredPdpCss).toMatch(
      /@import\s+['"]\.\/storefront-pdp-semantic\.css['"];?/
    );
    expect(deferredPdpCss).toMatch(
      /@import\s+['"]\.\/storefront-pdp-tabs\.css['"];?/
    );
    expect(deferredPdpCss).toMatch(
      /@import\s+['"]\.\/storefront-pdp-reviews\.css['"];?/
    );
  });

  it('validates OgaBassey category PDP route imports critical CSS in page, shares PDP CSS across renderer and loading, and excludes PDP CSS from client', () => {
    const categoryPdpPage = readStorefrontFile(
      '[slug]/(catalog)/(pdp)/[category]/[productSlug]/page.tsx'
    );
    const categoryPdpLoading = readStorefrontFile(
      '[slug]/(catalog)/(pdp)/[category]/[productSlug]/loading.tsx'
    );
    const defaultRenderer = readStorefrontFile(
      '[slug]/(catalog)/(pdp)/[category]/[productSlug]/default-product-page-renderer.tsx'
    );
    const defaultDetailClient = readStorefrontFile(
      '[slug]/(catalog)/(pdp)/[category]/[productSlug]/default-product-detail-client.tsx'
    );

    expect(categoryPdpPage).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-pdp-critical\.css['"];?/
    );
    expect(categoryPdpPage).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-pdp-critical-summary\.css['"];?/
    );
    expect(categoryPdpPage).not.toMatch(
      /storefront-pdp-description-critical\.css/
    );
    expect(categoryPdpPage).not.toMatch(/storefront-pdp-semantic\.css/);

    const deferredDetailIsland = readStorefrontFile(
      '../../components/storefront/ogabassey/pdp/deferred-detail-island.tsx'
    );
    expect(deferredDetailIsland).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-pdp-description-critical\.css['"];?/
    );
    const productSemanticSections = readStorefrontFile(
      '../../components/storefront/ogabassey/seo/product-semantic-sections.tsx'
    );
    expect(productSemanticSections).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-pdp-semantic\.css['"];?/
    );
    expect(categoryPdpLoading).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-pdp\.css['"];?/
    );
    expect(categoryPdpLoading).not.toMatch(
      /storefront-ogabassey-pdp-loading\.css/
    );
    // The deduplicated loading sheet must stay deleted, not just unimported.
    expect(
      existsSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          'storefront-ogabassey-pdp-loading.css'
        )
      )
    ).toBe(false);
    expect(defaultRenderer).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-pdp\.css['"];?/
    );
    expect(defaultDetailClient).not.toMatch(/storefront-pdp\.css/);

    const pdpCss = readStorefrontFile('storefront-pdp.css');
    expect(pdpCss).toContain('@source "./[slug]/storefront-loading-ui.tsx";');
    expect(pdpCss).toContain(
      '@source "../../components/storefront/ogabassey/storefront-loading-ui.tsx";'
    );
  });

  it('keeps homepage critical CSS off Tailwind and off the streamed Hero graph', () => {
    const homeCriticalCss = readStorefrontFile('storefront-home-critical.css');
    const homeCss = readStorefrontFile('storefront-home.css');

    expect(homeCriticalCss).not.toMatch(/^@import\s+["']tailwindcss["']/m);
    expect(homeCriticalCss).not.toMatch(/@source\s+/);
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*components\/Hero\.tsx["']/
    );
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*hero-mobile-carousel\.tsx["']/
    );
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*hero-desktop-grid\.tsx["']/
    );
    expect(homeCss).toMatch(/@source\s+["'][^"']*components\/Hero\.tsx["']/);
    expect(homeCss).toMatch(
      /@source\s+["'][^"']*hero-mobile-carousel\.tsx["']/
    );
    expect(homeCss).toMatch(/@source\s+["'][^"']*hero-desktop-grid\.tsx["']/);
  });

  it('registers store color tokens on the deferred homepage stylesheet', () => {
    const homeCss = readStorefrontFile('storefront-home.css');
    expect(homeCss).toMatch(/storefront-foundation\.css/);

    const tokens = readStorefrontFile('storefront-theme-tokens.css');
    expect(tokens).toMatch(/@theme inline/);
    expect(tokens).toMatch(
      /--color-store-secondary:\s*var\(--store-secondary,\s*#f3f4f6\)/
    );
  });

  it('keeps the broad storefront stylesheet off homepage and blog app sources', () => {
    const fullCss = readStorefrontFile('storefront-full.css');

    expect(fullCss).not.toMatch(/@source\s+["']\.\/["']/);
    expect(fullCss).not.toMatch(/@source\s+["'][^"']*\(home\)/);
    expect(fullCss).not.toMatch(/@source\s+["'][^"']*\(blog\)/);
    expect(fullCss).not.toMatch(/@source\s+["']\.\/\[slug\]["']/);
    expect(fullCss).toMatch(/@source\s+["']\.\/\[slug\]\/\*\.tsx["']/);
    expect(fullCss).toMatch(/@source\s+["']\.\/\[slug\]\/\(utility\)["']/);
    expect(fullCss).toMatch(/@source\s+["']\.\/\[slug\]\/\(catalog\)["']/);
  });

  it('locks committed LCP copy to the Inter fallback face without a render-blocking CSS file', () => {
    const lcpCopyCss = STOREFRONT_LCP_COPY_CSS;
    const slugLayout = readStorefrontFile('[slug]/layout.tsx');

    expect(slugLayout).not.toMatch(/storefront-lcp-copy\.css/);
    expect(slugLayout).toContain('StorefrontLcpCopyStyle');
    expect(lcpCopyCss).toContain('Inter Fallback');
    expect(lcpCopyCss).toContain('!important');
    expect(lcpCopyCss).toContain('html:has([data-storefront-shell])');
    expect(lcpCopyCss).toContain('[data-cwv-lcp-fold]');
    expect(lcpCopyCss).toContain('.ogabassey-blog-lcp-hero__frame');
    expect(lcpCopyCss).toContain('[data-cwv-lcp-copy="home"]');
    expect(lcpCopyCss).toContain('[data-cwv-lcp-copy="blog"]');
    expect(lcpCopyCss).toContain('[data-cwv-lcp-copy="compare"]');
    expect(lcpCopyCss).toContain('[data-cwv-lcp-copy="repair"]');
    expect(lcpCopyCss).toContain('[data-cwv-lcp-copy="imei"]');
    expect(lcpCopyCss).toContain('[data-cwv-lcp-copy="repairs"]');
    expect(lcpCopyCss).toContain('.sr-only');
    expect(lcpCopyCss).toContain(
      'body:has([data-blog-listing-filtered]) [data-blog-lcp-hero]'
    );
    expect(lcpCopyCss).toContain(
      'body:has([data-blog-lcp-hero]) [data-blog-featured-skeleton]'
    );
    expect(lcpCopyCss).toContain(
      'body:has([data-imei-result]) [data-imei-lcp-hero]'
    );
    expect(lcpCopyCss).toContain(
      'body:has([data-compare-category-page]) [data-compare-hub-chrome]'
    );
  });

  it('keeps homepage product-card utilities deferred while retaining critical grid geometry selectors', () => {
    const homeCriticalCss = readStorefrontFile('storefront-home-critical.css');
    const homeCss = readStorefrontFile('storefront-home.css');

    expect(homeCriticalCss).not.toMatch(/storefront-foundation\.css/);
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*HomeProductGrid\.tsx/
    );
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*HomeProductGridCard\.tsx/
    );
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*ProductRatingRow\.tsx/
    );
    expect(homeCriticalCss).toMatch(
      /@import\s+['"]\.\/storefront-home-critical-product-card\.css['"];?/
    );
    expect(homeCriticalCss.split('\n').length).toBeLessThanOrEqual(300);
    expect(homeCriticalCss).toMatch(/\.ogabassey-home-products\b/);
    expect(homeCriticalCss).toMatch(/\.ogabassey-home-products__grid\b/);
    expect(homeCriticalCss).toMatch(/\.ogabassey-home-products__empty\b/);
    expect(homeCriticalCss).not.toMatch(/\.ogabassey-home-product-card\b/);

    const productCardCss = readStorefrontFile(
      'storefront-home-critical-product-card.css'
    );
    expect(productCardCss.split('\n').length).toBeLessThanOrEqual(300);
    expect(productCardCss).toMatch(/\.ogabassey-home-product-card\b/);
    expect(productCardCss).toMatch(/\.ogabassey-home-product-card__media\b/);
    expect(productCardCss).toMatch(
      /\.ogabassey-home-product-card__condition--open-box\b/
    );
    expect(homeCriticalCss).not.toMatch(/animation:\s*pulse/);
    expect(homeCriticalCss).not.toMatch(/@keyframes\s+pulse/);

    expect(homeCss).toMatch(/@source\s+["'][^"']*HomeProductGrid\.tsx/);
    expect(homeCss).toMatch(/@source\s+["'][^"']*HomeProductGridCard\.tsx/);
    expect(homeCss).toMatch(/@source\s+["'][^"']*ProductRatingRow\.tsx/);
  });
});
