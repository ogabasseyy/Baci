import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { OGABASSEY_HOME_CAROUSEL_CRITICAL_CSS } from './ogabassey-home-carousel-critical-css';
import { OGABASSEY_HOME_CHROME_CRITICAL_CSS } from './ogabassey-home-chrome-critical-css';
import { OGABASSEY_HOME_LCP_CRITICAL_CSS } from './ogabassey-home-lcp-critical-css';

describe('homepage first-screen CSS', () => {
  it('inlines the extracted loading geometry with unchanged responsive heights', async () => {
    const from = 'src/app/(storefront)/storefront-core.css';
    const result = await postcss([tailwind({ optimize: true })]).process(
      readFileSync(from, 'utf8'),
      { from, map: false }
    );
    const heights: string[] = [];
    result.root.walkRules('.ogabassey-header-chrome-loading', (rule) => {
      rule.walkDecls('min-height', (declaration) => {
        heights.push(declaration.value);
      });
    });
    expect(heights).toEqual(['132px', '128px']);
    expect(result.css).not.toContain('storefront-header-loading.css');
  });

  it('keeps initial chrome declarations identical to the full stylesheet', () => {
    const core = postcss.parse(
      readFileSync('src/app/(storefront)/storefront-core.css', 'utf8')
    );
    const critical = postcss.parse(OGABASSEY_HOME_CHROME_CRITICAL_CSS);
    const normalize = (text: string) => text.replace(/\s+/g, '');
    critical.walkRules((rule) => {
      // The small scoped base reset mirrors Tailwind preflight, not core chrome.
      if (
        rule.parent?.parent?.type === 'atrule' &&
        rule.parent.parent.params === 'base'
      )
        return;
      for (const selector of rule.selectors) {
        rule.walkDecls((declaration) => {
          let found = false;
          core.walkRules((fullRule) => {
            if (
              !fullRule.selectors.some(
                (fullSelector) =>
                  fullSelector.replace(/\s+/g, ' ') ===
                  selector.replace(/\s+/g, ' ')
              )
            )
              return;
            fullRule.walkDecls(declaration.prop, (fullDeclaration) => {
              if (
                normalize(fullDeclaration.value) ===
                normalize(declaration.value)
              )
                found = true;
            });
          });
          expect(
            found,
            `${selector}: ${declaration.prop}: ${declaration.value}`
          ).toBe(true);
        });
      }
    });
  });

  it('keeps the inline payload small and independent of font or chunk requests', () => {
    const css = [
      OGABASSEY_HOME_CHROME_CRITICAL_CSS,
      OGABASSEY_HOME_CAROUSEL_CRITICAL_CSS,
      OGABASSEY_HOME_LCP_CRITICAL_CSS,
    ].join('\n');
    expect(gzipSync(css).byteLength).toBeLessThan(4000);
    expect(css).not.toMatch(/@import|@font-face|url\(/);
  });

  it('establishes Tailwind layer order before any async stylesheet', () => {
    expect(OGABASSEY_HOME_CHROME_CRITICAL_CSS).toMatch(
      /^@layer theme, base, components, utilities;/
    );
  });
});
