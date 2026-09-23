import { describe, expect, it } from 'vitest';
import { readStorefrontFile } from './storefront-css-partition-read';

describe('storefront CSS partitioning (core chrome sheets)', () => {
  it('keeps deferred assistant launcher selectors out of the PPR shell critical stylesheet', () => {
    const coreCss = readStorefrontFile('storefront-core.css');

    expect(coreCss).toMatch(/\.storefront-shell-loading/);
    expect(coreCss).toMatch(/\.storefront-ppr-static-shell/);
    expect(coreCss).toMatch(/\.ogabassey-navbar/);
    expect(coreCss).toMatch(/\.ogabassey-mobile-footer/);
    expect(coreCss).not.toMatch(/\.ogabassey-chat-/);
  });

  it('keeps category hub discovery card styles in the shared storefront core stylesheet', () => {
    const coreCss = readStorefrontFile('storefront-core.css');

    expect(coreCss).toMatch(/\.ogabassey-category-hub-card(?!-)\b/);
    expect(coreCss).toMatch(/\.ogabassey-category-hub-card-grid\b/);
    expect(coreCss).toMatch(
      /\.ogabassey-category-hub-card-grid\s*\{[^}]*display:\s*grid/s
    );
    expect(coreCss).toMatch(
      /\.ogabassey-category-hub-card__description\s*\{[^}]*font-size:\s*0\.9375rem/s
    );
  });

  it('keeps the cart empty-state styles in the shared storefront core stylesheet', () => {
    const coreCss = readStorefrontFile('storefront-core.css');

    expect(coreCss).toMatch(/\.ogabassey-cart-empty-state\b/);
    expect(coreCss).toMatch(
      /\.ogabassey-cart-empty-state\s*\{[^}]*var\(--ogabassey-surface\)/s
    );
    expect(coreCss).toMatch(
      /\.ogabassey-cart-empty-state__primary-action\s*\{[^}]*var\(--ogabassey-brand\)/s
    );
    expect(coreCss).not.toMatch(
      /\.ogabassey-cart-empty-state\s*\{[^}]*background:\s*#fff/s
    );
  });

  it('keeps OgaBassey footer contrast styles in the shared core stylesheet', () => {
    const coreCss = readStorefrontFile('storefront-core.css');

    expect(coreCss).toMatch(/\.ogabassey-footer\b/);
    expect(coreCss).toMatch(
      /\.ogabassey-footer\s*\{[^}]*background:\s*var\(--ogabassey-chrome-background\)/s
    );
    expect(coreCss).toMatch(
      /\.ogabassey-footer\s*\{[^}]*color:\s*var\(--ogabassey-chrome-text\)/s
    );
    expect(coreCss).not.toMatch(
      /\.ogabassey-footer\s*\{[^}]*background:\s*#1a1a1a/s
    );
    expect(coreCss).not.toMatch(/\.ogabassey-footer\s*\{[^}]*border-top:/s);
    expect(coreCss).not.toMatch(
      /\.ogabassey-footer\s*\{[^}]*var\(--store-background-text/s
    );
    expect(coreCss).not.toMatch(
      /\.ogabassey-footer\s*\{[^}]*var\(--store-background,/s
    );
    expect(coreCss).not.toMatch(
      /\.ogabassey-footer__pattern\s*\{[^}]*radial-gradient/s
    );
  });

  it('does not statically import storefront-core.css from the shared slug layout', () => {
    const layout = readStorefrontFile('[slug]/layout.tsx');

    expect(layout).not.toMatch(/storefront-core\.css/);
    expect(layout).not.toMatch(/storefront-lcp-copy\.css/);
    expect(layout).toContain('StorefrontLcpCopyStyle');
    expect(layout).not.toMatch(/store-not-published/);
    expect(layout).toMatch(/unpublished-storefront/);
  });

  it('restores storefront-core.css on commerce, content, customer, and PDP layouts', () => {
    const commerceLayout = readStorefrontFile('[slug]/(commerce)/layout.tsx');
    const contentLayout = readStorefrontFile('[slug]/(content)/layout.tsx');
    const customerLayout = readStorefrontFile('[slug]/(customer)/layout.tsx');
    const pdpLayout = readStorefrontFile('[slug]/(catalog)/(pdp)/layout.tsx');

    expect(commerceLayout).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-core\.css['"]/
    );
    expect(contentLayout).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-core\.css['"]/
    );
    expect(customerLayout).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-core\.css['"]/
    );
    expect(pdpLayout).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-core\.css['"]/
    );
  });

  it('keeps unpublished-store and homepage critical CSS off the render-blocking graph', () => {
    const staticHomePage = readStorefrontFile(
      '[slug]/(home)/ogabassey-static-home-page.tsx'
    );
    const homeCss = readStorefrontFile('storefront-home.css');
    const unpublishedNotice = readStorefrontFile(
      '../../components/storefront/store-not-published.tsx'
    );

    expect(staticHomePage).not.toMatch(/storefront-home-critical\.css/);
    expect(homeCss).toMatch(/storefront-home-critical\.css/);
    expect(unpublishedNotice).not.toMatch(/store-not-published\.module\.css/);
    expect(unpublishedNotice).toMatch(/STORE_NOT_PUBLISHED_CSS/);
  });

  it('loads deferred assistant launcher styles through the assistant chunk stylesheet', () => {
    const chatCss = readStorefrontFile('storefront-chat.css');
    const deferredChat = readStorefrontFile(
      '../../components/storefront/ogabassey/components/chat/DeferredChatWidget.tsx'
    );

    expect(chatCss).toMatch(/\.ogabassey-chat-anchor/);
    expect(chatCss).toMatch(/\.ogabassey-chat-button/);
    expect(chatCss).toMatch(/\.ogabassey-chat-badge/);
    expect(deferredChat).not.toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-chat\.css['"]/
    );
    expect(deferredChat).toMatch(/StorefrontChatStyleLoader/);

    const chatLoader = readStorefrontFile('storefront-chat-style-loader.tsx');
    expect(chatLoader).not.toContain('loadStylesheetAfterFirstInput');
  });
});
