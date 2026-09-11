import { describe, expect, it } from 'vitest';
import { readStorefrontFile } from './storefront-css-partition-read';

describe('storefront CSS partitioning (route sheets)', () => {
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

  it('validates OgaBassey category PDP route imports critical CSS in page, PDP CSS in renderer, and excludes PDP CSS from client', () => {
    const categoryPdpPage = readStorefrontFile(
      '[slug]/(catalog)/(pdp)/[category]/[productSlug]/page.tsx'
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
    expect(defaultRenderer).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-pdp\.css['"];?/
    );
    expect(defaultDetailClient).not.toMatch(/storefront-pdp\.css/);
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

  it('keeps listing, utility, and blog Tailwind sheets off the render-blocking layout graph', () => {
    const listingLayout = readStorefrontFile(
      '[slug]/(catalog)/(listing)/layout.tsx'
    );
    const utilityLayout = readStorefrontFile('[slug]/(utility)/layout.tsx');
    const blogLayout = readStorefrontFile('[slug]/(blog)/layout.tsx');
    const blogListingQuery = readStorefrontFile(
      '[slug]/(blog)/blog/blog-listing-query-content.tsx'
    );
    const genericHome = readStorefrontFile(
      '[slug]/(home)/generic-storefront-home-page.tsx'
    );

    expect(listingLayout).not.toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-full\.css['"]/
    );
    expect(utilityLayout).not.toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-full\.css['"]/
    );
    expect(blogLayout).not.toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-blog\.css['"]/
    );
    expect(listingLayout).toContain('StorefrontFullStyleLoader');
    expect(utilityLayout).toContain('StorefrontFullStyleLoader');
    expect(blogLayout).toContain('StorefrontBlogStyleLoader');
    expect(utilityLayout).not.toContain('storefront-eager-full-css-layout');
    expect(blogLayout).not.toContain('storefront-eager-blog-css-layout');
    expect(blogListingQuery).not.toContain('storefront-eager-blog-css-layout');
    expect(genericHome).not.toContain('storefront-eager-full-css-layout');
    expect(genericHome).toContain('StorefrontFullStyleLoader');

    const comparePage = readStorefrontFile(
      '[slug]/(catalog)/(listing)/compare/page.tsx'
    );
    expect(comparePage).not.toContain('storefront-eager-full-css-layout');
  });

  it('locks committed LCP copy to the Inter fallback face without a render-blocking CSS file', () => {
    const lcpCopyCss = readStorefrontFile('storefront-lcp-copy-css.ts');
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

  it('keeps blog post renderer CSS off the listing stylesheet', () => {
    const blogCss = readStorefrontFile('storefront-blog.css');
    const blogPostCss = readStorefrontFile('storefront-blog-post.css');

    expect(blogCss).not.toMatch(/components\/blog\/renderer/);
    expect(blogCss).toMatch(/ogabassey-blog-lcp-hero/);
    expect(blogCss).toMatch(
      /@source\s+["'][^"']*components\/ui\/badge\.tsx["']/
    );
    expect(blogCss).toMatch(
      /@source\s+["'][^"']*components\/ui\/card\.tsx["']/
    );
    expect(blogPostCss).toMatch(/components\/blog\/renderer/);
    expect(blogPostCss).toMatch(/@source\s+["'][^"']*blog\/\[postSlug\]["']/);
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
