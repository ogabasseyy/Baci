import { render } from '@testing-library/react';
import postcss, { type AnyNode } from 'postcss';
import { describe, expect, it } from 'vitest';
import { StorefrontLcpCopyStyle } from './storefront-lcp-copy-style';

describe('StorefrontLcpCopyStyle', () => {
  it('sizes and positions the shared header before streamed route CSS arrives', () => {
    render(<StorefrontLcpCopyStyle />);
    const style = document.querySelector(
      'style[data-href~="storefront-lcp-copy"], style[href="storefront-lcp-copy"]'
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
});
