import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'storefront-core.css'
);
const storefrontCoreCss = readFileSync(cssPath, 'utf8');

/**
 * Returns the first concrete rule body for a selector in this stylesheet.
 * These assertions intentionally target the base navbar contract, not media
 * overrides, because the bug was caused by the base header row clipping the
 * lazily mounted autocomplete layer before desktop/mobile overrides apply.
 */
const cssRuleFor = (selector: string, css = storefrontCoreCss) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(
    new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`)
  );
  return match?.groups?.body ?? '';
};

describe('storefront-core OgaBassey navbar layering', () => {
  it('reserves streamed main content on every route without relying on scanned utilities', () => {
    expect(cssRuleFor('.ogabassey-storefront-main')).toContain(
      'min-height: calc(100svh - 132px)'
    );
    expect(storefrontCoreCss).toMatch(
      /@media\s*\(min-width:\s*768px\)\s*\{\s*\.ogabassey-storefront-main\s*\{\s*min-height:\s*100svh/
    );
  });
  it('reserves the ad frame width independently of its percentage-sized child', () => {
    const frame = cssRuleFor('.ogabassey-ad-slot-frame');
    expect(frame).toContain('width: var(--ad-slot-w)');
    expect(frame).toContain('max-width: 100%');
    expect(storefrontCoreCss).toMatch(
      /@media\s*\(min-width:\s*768px\)\s*\{\s*\.ogabassey-ad-slot-frame\s*\{\s*width:\s*var\(--ad-slot-w-lg\)/
    );
  });
  it('reserves the actual header height at mobile and desktop breakpoints', () => {
    const loadingCss = readFileSync(
      join(dirname(cssPath), 'storefront-header-loading.css'),
      'utf8'
    );
    expect(storefrontCoreCss).toMatch(
      /@import\s+['"]\.\/storefront-header-loading\.css['"]\s*;/
    );
    const headerSlot = cssRuleFor(
      '.ogabassey-header-chrome-loading',
      loadingCss
    );
    expect(headerSlot).toMatch(/min-height\s*:\s*132px/);
    expect(loadingCss).toMatch(
      /@media\s*\(min-width\s*:\s*768px\)\s*\{\s*\.ogabassey-header-chrome-loading\s*\{\s*min-height\s*:\s*128px;/
    );
  });

  it('allows search autocomplete suggestions to render above the secondary nav instead of being clipped by the black header row', () => {
    expect(cssRuleFor('.ogabassey-navbar__top')).toContain('overflow: visible');
    expect(cssRuleFor('.ogabassey-navbar__search-wrap')).toContain(
      'z-index: 30'
    );
  });

  it('does not keep the clipping and lower layer values that hid autocomplete suggestions', () => {
    expect(cssRuleFor('.ogabassey-navbar__top')).not.toContain(
      'overflow: hidden'
    );
    expect(cssRuleFor('.ogabassey-navbar__search-wrap')).not.toContain(
      'z-index: 10'
    );
  });
});

describe('storefront overlay priority', () => {
  it('hides competing chrome while the privacy dialog is visible', () => {
    const selector = 'body:has(.storefront-cookie-consent)';
    for (const widget of [
      '.ogabassey-chat-anchor',
      '.ogabassey-offer-popup',
      '.ogabassey-newsletter-popup',
    ]) {
      expect(storefrontCoreCss).toContain(widget);
    }
    expect(cssRuleFor(`${selector} .ogabassey-newsletter-popup`)).toContain(
      'display: none'
    );
    expect(storefrontCoreCss).toMatch(
      /body:has\(\.storefront-cookie-consent\)\s+\.ogabassey-chat-anchor:not\(:has\(\.ogabassey-chat-window\)\)/
    );
    expect(storefrontCoreCss).toMatch(
      /body:has\(\.ogabassey-newsletter-popup\)\s+\.ogabassey-chat-anchor:not\(:has\(\.ogabassey-chat-window\)\)\s*\{\s*display:\s*none/
    );
    expect(storefrontCoreCss).toMatch(
      /body:has\(\.ogabassey-chat-anchor\s+\.ogabassey-chat-window\)\s+\.ogabassey-newsletter-popup\s*\{\s*display:\s*none/
    );
    expect(storefrontCoreCss).toMatch(
      /body:has\(\.ogabassey-chat-anchor\s+\.ogabassey-chat-window\)[\s\S]*?\.ogabassey-offer-popup,[\s\S]*?\.ogabassey-newsletter-popup\s*\{\s*display:\s*none/
    );
    expect(storefrontCoreCss).toMatch(
      /body:has\(\.ogabassey-offer-popup\):not\(:has\(\.storefront-cookie-consent\)\)\s+\.ogabassey-chat-anchor:not\(:has\(\.ogabassey-chat-window\)\)\s*\{\s*display:\s*none/
    );
    const offerSelector =
      'body:has(.ogabassey-offer-popup):not(:has(.storefront-cookie-consent))';
    const offerRuleIndex = storefrontCoreCss.indexOf(offerSelector);
    const consentRulesStart = storefrontCoreCss.indexOf(
      '/* Consent takes priority over promotional and assistant chrome.'
    );
    expect(storefrontCoreCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*\n\}\n\n\/\* Consent takes priority over promotional and assistant chrome\./
    );
    expect(offerRuleIndex).toBeGreaterThan(consentRulesStart);
    expect(
      storefrontCoreCss.slice(consentRulesStart, offerRuleIndex)
    ).not.toContain('@media');
  });
});
