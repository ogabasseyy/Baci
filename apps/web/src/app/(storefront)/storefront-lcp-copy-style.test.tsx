import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StorefrontLcpCopyStyle } from './storefront-lcp-copy-style';

describe('StorefrontLcpCopyStyle', () => {
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
