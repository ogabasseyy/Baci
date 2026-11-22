import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { OGABASSEY_HOME_CAROUSEL_CRITICAL_CSS } from './ogabassey-home-carousel-critical-css';

function declarationsFor(selector: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  postcss
    .parse(OGABASSEY_HOME_CAROUSEL_CRITICAL_CSS)
    .walkRules(selector, (rule) => {
      rule.walkDecls((declaration) => {
        declarations[declaration.prop] = declaration.value;
      });
    });
  return declarations;
}

describe('homepage carousel critical CSS', () => {
  it('uses matched theme surfaces and text for utility panels', () => {
    for (const selector of [
      '[data-ogabassey-hero-utility]',
      '[data-ogabassey-mobile-utility-panel]',
    ]) {
      expect(declarationsFor(selector)).toMatchObject({
        background: 'var(--store-background, #ffffff)',
        color: 'var(--store-foreground, #111827)',
      });
    }
    expect(declarationsFor('[data-ogabassey-hero-utility]')).toMatchObject({
      'border-top': '1px solid var(--ogabassey-border, #f3f4f6)',
      'border-bottom': '1px solid var(--ogabassey-border, #f3f4f6)',
    });
    expect(
      declarationsFor('[data-ogabassey-mobile-utility-panel]')
    ).toMatchObject({
      'min-height': '158px',
      border: '1px solid var(--ogabassey-border, #f3f4f6)',
    });
    expect(
      declarationsFor('[data-ogabassey-hero-utility] span>span:last-child')
    ).toMatchObject({
      display: 'inline-grid',
      'line-height': '1',
    });
  });
  it('contains product fill images before the deferred card stylesheet arrives', () => {
    expect(declarationsFor('.ogabassey-home-product-card')).toMatchObject({
      position: 'relative',
    });
    expect(
      declarationsFor('.ogabassey-home-product-card__media')
    ).toMatchObject({
      position: 'relative',
      background:
        'var(--ogabassey-surface-muted,color-mix(in srgb,var(--ogabassey-surface-text,var(--store-background-text,#111827)) 4%,var(--ogabassey-surface,var(--store-background,#ffffff))))',
      overflow: 'hidden',
      'aspect-ratio': '1 / 1',
    });
  });

  it('reserves the mobile carousel height before async styles arrive', () => {
    expect(declarationsFor('[data-ogabassey-mobile-hero-panel]')).toMatchObject(
      {
        position: 'relative',
        height: '192px',
        overflow: 'hidden',
        'touch-action': 'pan-y',
      }
    );
    expect(declarationsFor('[data-ogabassey-hero] picture')).toMatchObject({
      position: 'absolute',
      inset: '0',
      display: 'block',
      height: '100%',
      width: '100%',
    });
  });

  it('only paints the active slide before the full utility stylesheet arrives', () => {
    expect(
      declarationsFor(
        '[data-ogabassey-mobile-hero-panel] > [aria-hidden="true"]'
      )
    ).toMatchObject({ opacity: '0', 'z-index': '0' });
    expect(
      declarationsFor(
        '[data-ogabassey-mobile-hero-panel] > [aria-hidden="false"]'
      )
    ).toMatchObject({ opacity: '1', 'z-index': '10' });
  });

  it('locks mobile and desktop hero title/price typography and img padding so the slide-0 image always wins LCP area', () => {
    expect(
      declarationsFor(
        '[data-ogabassey-mobile-hero-panel] .ogabassey-hero-title'
      )
    ).toMatchObject({
      '-webkit-line-clamp': '3',
      'font-size': '1.25rem',
      'line-height': '1.05',
      overflow: 'hidden',
    });
    expect(
      declarationsFor(
        '[data-ogabassey-mobile-hero-panel] .ogabassey-hero-price'
      )
    ).toMatchObject({
      'font-size': '11px',
      'font-weight': '600',
    });
    expect(
      declarationsFor('[data-ogabassey-desktop-hero]>a .ogabassey-hero-title')
    ).toMatchObject({
      'font-size': '3rem',
    });
    expect(
      declarationsFor('[data-ogabassey-desktop-hero]>a .ogabassey-hero-price')
    ).toMatchObject({
      'font-size': '1.25rem',
      'line-height': '1.75rem',
    });
    expect(
      declarationsFor('[data-ogabassey-mobile-hero-panel] img')
    ).toMatchObject({
      'object-fit': 'contain',
      padding: '.25rem',
    });
  });
});
