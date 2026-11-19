import { render } from '@testing-library/react';
import postcss, { type AnyNode } from 'postcss';
import { describe, expect, it } from 'vitest';
import { OGABASSEY_DARK_TOKENS } from '@/components/storefront/ogabassey/dark-mode-tokens';
import { OgabasseyHeaderCriticalStyle } from '@/components/storefront/ogabassey/storefront-header-critical-style';
import { OgabasseyHomeCriticalShell } from './ogabassey/ogabassey-home-critical-shell';
import { OgabasseyPublicationSafeHeroFallback } from './ogabassey/ogabassey-publication-safe-hero-fallback';
import { readStorefrontFile } from './storefront-css-partition-read';
import { StorefrontLcpCopyStyle } from './storefront-lcp-copy-style';

describe('StorefrontLcpCopyStyle', () => {
  it('does not ship template-specific header rules in the tenant-neutral shell', () => {
    render(<StorefrontLcpCopyStyle />);
    const css = [...document.querySelectorAll('style')]
      .map((style) => style.textContent)
      .join('\n');
    const headerRules: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      if (rule.selector.includes('.ogabassey-navbar'))
        headerRules.push(rule.selector);
    });
    expect(headerRules).toEqual([]);
  });
  it.each([
    OgabasseyHomeCriticalShell,
    OgabasseyPublicationSafeHeroFallback,
  ])('emits the shared header rules only once with %s', (HomeShell) => {
    render(
      <>
        <StorefrontLcpCopyStyle />
        <OgabasseyHeaderCriticalStyle />
        <HomeShell />
      </>
    );
    let widths = 0;
    for (const style of document.querySelectorAll('style'))
      postcss
        .parse(style.textContent ?? '')
        .walkRules('.ogabassey-navbar-search__icon', (rule) => {
          rule.walkDecls('width', () => {
            widths++;
          });
        });
    expect(widths).toBe(1);
  });
  it('sizes and positions the shared header before streamed route CSS arrives', () => {
    render(<OgabasseyHeaderCriticalStyle />);
    const style = document.querySelector(
      'style[data-href~="ogabassey-header-critical"], style[href="ogabassey-header-critical"]'
    );
    const rules = postcss.parse(style?.textContent ?? '');
    const values: Record<string, string> = {};
    rules.walkRules('.ogabassey-navbar-search__icon', (rule) => {
      rule.walkDecls((decl) => {
        values[decl.prop] = decl.value;
      });
    });
    expect(values.width).toBe('1.25rem');
    expect(values.height).toBe('1.25rem');
    expect(values.position).toBe('absolute');
    const positions: string[] = [];
    rules.walkRules('.ogabassey-navbar', (rule) => {
      let parent: AnyNode | undefined = rule.parent;
      while (parent) {
        if (parent.type === 'atrule' && parent.name === 'media') return;
        parent = parent.parent;
      }
      rule.walkDecls('position', (decl) => {
        positions.push(decl.value);
      });
    });
    expect(positions).toContain('sticky');
  });
  it('delivers the responsive main reserve before any deferred stylesheet or input', () => {
    render(<StorefrontLcpCopyStyle />);
    const style = document.querySelector<HTMLStyleElement>(
      'style[href="storefront-lcp-copy"], style[data-href~="storefront-lcp-copy"]'
    );
    expect(style).not.toBeNull();
    const rules = [...(style?.sheet?.cssRules ?? [])];
    const main = rules.find(
      (rule): rule is CSSStyleRule =>
        rule.type === CSSRule.STYLE_RULE &&
        'selectorText' in rule &&
        rule.selectorText === '.ogabassey-storefront-main'
    );
    expect(main?.style.getPropertyValue('min-height')).toBe(
      'calc(100svh - 132px)'
    );
    const desktop = rules
      .filter(
        (rule): rule is CSSMediaRule =>
          rule.type === CSSRule.MEDIA_RULE &&
          'conditionText' in rule &&
          rule.conditionText === '(min-width: 768px)'
      )
      .flatMap((rule) => [...rule.cssRules])
      .find(
        (rule): rule is CSSStyleRule =>
          rule.type === CSSRule.STYLE_RULE &&
          'selectorText' in rule &&
          rule.selectorText === '.ogabassey-storefront-main'
      );
    expect(desktop?.style.getPropertyValue('min-height')).toBe('100svh');
    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
  });

  it('injects committed LCP copy CSS without a stylesheet link', () => {
    render(<StorefrontLcpCopyStyle />);
    const css =
      document.querySelector('style[href="storefront-lcp-copy"]')
        ?.textContent ??
      document.querySelector('style')?.textContent ??
      '';

    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
    expect(css).toContain('Inter Fallback');
    expect(css).toContain('[data-cwv-lcp-copy="blog"]');
    expect(css).toContain('.sr-only');
    expect(css).toContain('!important');
  });

  it('inlines OgaBassey dark-mode custom property overrides on first paint to prevent a white flash before deferred stylesheets load', () => {
    render(<StorefrontLcpCopyStyle />);
    const css =
      document.querySelector('style[href="storefront-lcp-copy"]')
        ?.textContent ??
      document.querySelector('style')?.textContent ??
      '';
    const darkTokensCss = readStorefrontFile(
      'storefront-ogabassey-dark-mode-tokens.css'
    ).toLowerCase();

    const expectedBg = OGABASSEY_DARK_TOKENS.background.toLowerCase();
    const expectedFg = OGABASSEY_DARK_TOKENS.foreground.toLowerCase();
    const expectedSecondary = OGABASSEY_DARK_TOKENS.secondary.toLowerCase();
    const expectedCard = OGABASSEY_DARK_TOKENS.card.toLowerCase();
    const expectedBorder = OGABASSEY_DARK_TOKENS.border.toLowerCase();

    expect(css).toContain(`--storefront-dark-background: ${expectedBg};`);
    expect(css).toContain(`--storefront-dark-secondary: ${expectedSecondary};`);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(
      'body:has(.storefront-variant-ogabassey.storefront-mode-system)'
    );
    expect(css).toContain(
      '.storefront-ppr-static-shell:has([data-ogabassey-home-hero-reserve-fallback])'
    );
    expect(css).toContain(
      '--store-background: var(--storefront-dark-background) !important;'
    );
    expect(css).toContain(
      '--store-secondary: var(--storefront-dark-secondary) !important;'
    );
    expect(css).toContain(
      '--ogabassey-surface: var(--storefront-dark-card) !important;'
    );

    for (const declaration of [
      `--store-background: ${expectedBg} !important;`,
      `--store-foreground: ${expectedFg} !important;`,
      `--store-secondary: ${expectedSecondary} !important;`,
      `--store-surface: ${expectedCard} !important;`,
      `--ogabassey-surface: ${expectedCard} !important;`,
      `--ogabassey-border: ${expectedBorder} !important;`,
    ]) {
      expect(css).toContain(declaration);
      expect(darkTokensCss).toContain(declaration);
    }
  });
});
