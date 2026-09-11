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
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\.ogabassey-blog-lcp-hero__frame\s*\{[^}]*text-decoration: none/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain('font-size: 1.875rem !important');
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'letter-spacing: normal !important'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain('color: #111827 !important');
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'html:has([data-storefront-shell])'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'html:has([data-storefront-shell]) body'
    );
    expect(STOREFRONT_LCP_COPY_CSS).not.toMatch(
      /html:has\(\[data-storefront-shell\]\)(?:\s*,\s*html:has\(\[data-storefront-shell\]\) body)?\s*\{[^}]*font-family:[^}]*!important/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /html:has\(\[data-storefront-shell\]\) body \{[^}]*margin: 0/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain('@layer base');
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /html:has\(\[data-storefront-shell\]\) p \{[^}]*margin: 0/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain('box-sizing: border-box');
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'body:has([data-compare-hub-intro-resolved]) [data-compare-hub-intro-pending]'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain('[data-cwv-lcp-support]');
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[data-cwv-lcp-copy="compare"\]\s*\{[^}]*color: var\(--store-background-text, #111827\) !important/
    );
    expect(STOREFRONT_LCP_COPY_CSS).not.toMatch(
      /\[data-cwv-lcp-support\]\s*\{[^}]*margin:\s*0\s*!important/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'body:has([data-blog-listing-filtered]) [data-blog-lcp-hero]'
    );
    expect(STOREFRONT_LCP_COPY_CSS).not.toContain(
      'body:has([data-blog-live-featured]) [data-blog-lcp-hero]'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'body:has([data-blog-lcp-hero]) [data-blog-featured-skeleton]'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'body:has([data-imei-result]) [data-imei-lcp-hero]'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'body:has([data-compare-category-page]) [data-compare-hub-chrome]'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain('[data-cwv-lcp-copy="imei"]');
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'var(--store-background-text, #111827)'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain('font-size: 3rem !important');
    expect(STOREFRONT_LCP_COPY_CSS).toContain('font-size: 3.75rem !important');
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      '.storefront-ppr-static-shell__content ~ .storefront-ppr-static-shell__fallback'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      '.storefront-ppr-static-shell > .storefront-ppr-static-shell__fallback'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      '.storefront-ppr-static-shell__content:has('
    );
  });
});
