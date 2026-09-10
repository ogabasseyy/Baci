import { describe, expect, it } from 'vitest';
import { STOREFRONT_LCP_COPY_CSS } from './storefront-lcp-copy-css';

describe('STOREFRONT_LCP_COPY_CSS', () => {
  it('locks fallback fonts and first-paint sr-only clipping', () => {
    expect(STOREFRONT_LCP_COPY_CSS).toContain('Inter Fallback');
    expect(STOREFRONT_LCP_COPY_CSS).toContain('.sr-only');
    expect(STOREFRONT_LCP_COPY_CSS).toContain('!important');
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      '.ogabassey-blog-lcp-hero__frame'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain('text-decoration: none');
    expect(STOREFRONT_LCP_COPY_CSS).toContain('font-size: 1.875rem !important');
    expect(STOREFRONT_LCP_COPY_CSS).toContain('[data-cwv-lcp-support]');
  });
});
