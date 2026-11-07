import { describe, expect, it } from 'vitest';
import { STOREFRONT_LCP_COPY_CSS } from './storefront-lcp-copy-css';

describe('STOREFRONT_LCP_COPY_CSS', () => {
  it('does not reserve an empty viewport below the IMEI heading', () => {
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[data-imei-lcp-hero\] \[data-cwv-lcp-fold\]/
    );
  });
  it('does not reserve an empty viewport below the compare hub heading', () => {
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[data-compare-hub-chrome\] \[data-cwv-lcp-fold\]/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[data-compare-hub-intro\] \[data-cwv-lcp-fold\]/
    );
  });
  it('keeps the repair booking form directly beneath its LCP intro', () => {
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[data-repair-booking-lcp-fold\]\s*\{\s*min-height: 0;/
    );
  });
  it('keeps the repair LCP heading aligned and sized like its hero', () => {
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[data-cwv-lcp-copy="repair"\]\s*\{[^}]*font-size: 1\.875rem !important;[^}]*letter-spacing: -0\.025em !important;[^}]*margin: 0 !important;[^}]*text-align: left !important;/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /@media \(min-width: 640px\)\s*\{\s*\[data-cwv-lcp-copy="repair"\]\s*\{\s*font-size: 2\.25rem !important;\s*line-height: 2\.5rem !important;/
    );
  });
  it('locks fallback fonts and first-paint sr-only clipping', () => {
    expect(STOREFRONT_LCP_COPY_CSS).toContain('Inter Fallback');
    expect(STOREFRONT_LCP_COPY_CSS).toContain('h1.sr-only');
    expect(STOREFRONT_LCP_COPY_CSS).not.toMatch(/(?:^|\n)\.sr-only \{/);
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
    expect(STOREFRONT_LCP_COPY_CSS).not.toContain('color: #111827 !important');
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'var(--store-background-text, #111827)'
    );
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
    expect(STOREFRONT_LCP_COPY_CSS).not.toMatch(
      /\[data-cwv-lcp-copy="imei"\][^{]*\{[^}]*letter-spacing: -0\.025em/
    );
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
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      'var(--store-background, #f9fafb)'
    );
    expect(STOREFRONT_LCP_COPY_CSS).not.toContain(
      'var(--color-gray-50, #f9fafb)'
    );
  });
  it('locks the brand/family hub intro to the fallback face at its Tailwind sizes without overriding header spacing', () => {
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[data-cwv-lcp-copy="authority-hub"\]\s*\{\s*font-size: 1rem !important;\s*line-height: 1\.75rem !important;\s*\}/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /@media \(min-width: 640px\)\s*\{\s*\[data-cwv-lcp-copy="authority-hub"\]\s*\{\s*font-size: 1\.125rem !important;/
    );
  });
  it('keeps the blog LCP hero compact after streaming while reserving viewport height on the pending fallback', () => {
    expect(STOREFRONT_LCP_COPY_CSS).toContain('.ogabassey-blog-lcp-hero');
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      '.ogabassey-blog-featured-story__title'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      '.ogabassey-blog-featured-story__scrim'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      '.ogabassey-blog-featured-story__media img'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\.ogabassey-blog-lcp-hero__frame\s*\{[^}]*height:\s*400px;[^}]*margin-bottom:\s*0;/s
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /@media\s*\(min-width:\s*768px\)\s*\{[\s\S]*?\.ogabassey-blog-lcp-hero__frame\s*\{[^}]*height:\s*500px;/
    );
    expect(STOREFRONT_LCP_COPY_CSS).not.toMatch(
      /\.ogabassey-blog-lcp-hero\s*\{[^}]*min-height:\s*100svh/s
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[aria-label="Loading blog posts"\]\s*\{[^}]*min-height:\s*100svh;/s
    );
  });
  it('locks blog post title typography and reserves 16:9 hero aspect ratio', () => {
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      '[data-cwv-lcp-copy="blog-post"]'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toContain(
      '.ogabassey-blog-post-hero-frame'
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[data-cwv-lcp-copy="blog-post"\]\s*\{[^}]*font-family:\s*"Inter Fallback"/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\[data-cwv-lcp-copy="blog-post"\]\s*\{[^}]*font-size:\s*1\.875rem !important;/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /@media \(min-width: 768px\)\s*\{\s*\[data-cwv-lcp-copy="blog-post"\]\s*\{\s*font-size:\s*2\.25rem !important;/
    );
    expect(STOREFRONT_LCP_COPY_CSS).toMatch(
      /\.ogabassey-blog-post-hero-frame\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;/
    );
  });
});
