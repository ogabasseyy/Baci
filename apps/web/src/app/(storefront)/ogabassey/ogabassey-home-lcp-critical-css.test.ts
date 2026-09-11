import { describe, expect, it } from 'vitest';
import { OGABASSEY_HOME_LCP_CRITICAL_CSS } from './ogabassey-home-lcp-critical-css';

describe('OGABASSEY_HOME_LCP_CRITICAL_CSS', () => {
  it('hides the desktop hero on mobile before Tailwind loads', () => {
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '[data-ogabassey-desktop-hero] { display: none !important; }'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '@media (max-width: 767px)'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '[data-ogabassey-mobile-hero]'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '[data-ogabassey-desktop-hero],\n  [data-ogabassey-empty-desktop-hero] {\n    display: grid !important;'
    );
  });

  it('clips a desktop-only document title without waiting on Tailwind .sr-only', () => {
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '.ogabassey-home-lcp-desktop-title'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      'clip-path: inset(50%) !important'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '.ogabassey-home-lcp-desktop-title { display: none !important; }'
    );
  });

  it('keeps the mobile LCP shell one viewport tall so the footer stays below the fold', () => {
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '[data-ogabassey-home-lcp-shell] { min-height: 100svh; }'
    );
  });

  it('reserves the semantic footer height before Tailwind loads', () => {
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      'footer[aria-label="Semantic storefront footer"]'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain('min-height: 1100px');
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '@media (min-width: 768px)'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain('min-height: 910px');
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '@media (min-width: 1024px)'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain('min-height: 770px');
  });

  it('sizes committed LCP copy without Tailwind utilities', () => {
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '.ogabassey-home-committed-lcp'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain('font-size: 0.875rem');
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain('-webkit-line-clamp: 2');
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain('Inter Fallback');
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      'font-size: 0.875rem !important'
    );
    expect(OGABASSEY_HOME_LCP_CRITICAL_CSS).toContain(
      '.ogabassey-home-unique-copy'
    );
  });
});
