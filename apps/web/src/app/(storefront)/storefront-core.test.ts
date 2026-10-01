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
