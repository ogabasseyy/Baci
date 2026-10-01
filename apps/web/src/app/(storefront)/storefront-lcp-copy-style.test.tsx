import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StorefrontLcpCopyStyle } from './storefront-lcp-copy-style';

describe('StorefrontLcpCopyStyle', () => {
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
