import { describe, expect, it } from 'vitest';
import { readStorefrontFile } from './storefront-css-partition-read';

describe('storefront CSS partitioning (route layouts and delta sheets)', () => {
  it('defers shared listing styles but loads scoped blog styles before first paint', () => {
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
    expect(blogLayout).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-blog\.css['"]/
    );
    expect(listingLayout).toContain('StorefrontFullStyleLoader');
    expect(utilityLayout).toContain('StorefrontFullStyleLoader');
    expect(blogLayout).not.toContain('StorefrontBlogStyleLoader');
    expect(utilityLayout).not.toContain('storefront-eager-full-css-layout');
    expect(blogLayout).not.toContain('storefront-eager-blog-css-layout');
    expect(blogListingQuery).not.toContain('storefront-eager-blog-css-layout');
    expect(genericHome).not.toContain('storefront-eager-full-css-layout');
    expect(genericHome).toContain('StorefrontFullStyleLoader');

    const comparePage = readStorefrontFile(
      '[slug]/(catalog)/(listing)/compare/page.tsx'
    );
    const compareLayout = readStorefrontFile(
      '[slug]/(catalog)/(listing)/compare/layout.tsx'
    );
    const categoryLayout = readStorefrontFile(
      '[slug]/(catalog)/(listing)/[category]/layout.tsx'
    );
    const productsLayout = readStorefrontFile(
      '[slug]/(catalog)/(listing)/products/layout.tsx'
    );
    const searchLayout = readStorefrontFile(
      '[slug]/(catalog)/(listing)/search/layout.tsx'
    );
    const contentLayout = readStorefrontFile('[slug]/(content)/layout.tsx');
    expect(
      comparePage.match(
        /var\(--store-background,#ffffff\).*?var\(--store-background-text,#111827\)/g
      )
    ).toHaveLength(2);
    expect(comparePage).not.toContain('storefront-eager-full-css-layout');
    expect(compareLayout).toContain('StorefrontEagerListingCssLayout');
    expect(categoryLayout).toContain('StorefrontEagerListingCssLayout');
    expect(productsLayout).toContain('StorefrontEagerListingCssLayout');
    expect(searchLayout).toContain('StorefrontEagerListingCssLayout');
    expect(contentLayout).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-content\.css['"]/
    );
    expect(contentLayout).not.toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-full\.css['"]/
    );
    expect(contentLayout).toContain('StorefrontFullStyleLoader');

    for (const utilityChildLayout of [
      '[slug]/(utility)/member-status/layout.tsx',
      '[slug]/(utility)/quiz/layout.tsx',
      '[slug]/(utility)/repair/status/layout.tsx',
      '[slug]/(utility)/repairs/[deviceSlug]/layout.tsx',
      '[slug]/(utility)/reviews/layout.tsx',
      '[slug]/(utility)/swap/layout.tsx',
      '[slug]/(utility)/unlock-orders/layout.tsx',
    ]) {
      const childLayoutContent = readStorefrontFile(utilityChildLayout);
      expect(childLayoutContent).not.toContain('StorefrontEagerFullCssLayout');
      expect(childLayoutContent).toContain('StorefrontEagerUtilityCssLayout');
    }
  });

  it('keeps blog post renderer CSS off the listing stylesheet and avoids duplicate foundation imports', () => {
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
    expect(blogPostCss).toMatch(
      /@import\s+["']tailwindcss\/utilities["']\s+source\(none\)/
    );
    expect(blogPostCss).not.toMatch(
      /@import\s+["']\.\/storefront-foundation\.css["']/
    );
    expect(blogPostCss).toMatch(/components\/blog\/renderer/);
    expect(blogPostCss).toMatch(/@source\s+["'][^"']*blog\/\[postSlug\]["']/);
  });
});
