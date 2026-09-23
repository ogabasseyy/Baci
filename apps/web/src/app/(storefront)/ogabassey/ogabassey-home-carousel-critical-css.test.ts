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
  });
  it('contains product fill images before the deferred card stylesheet arrives', () => {
    expect(declarationsFor('.ogabassey-home-product-card')).toMatchObject({
      position: 'relative',
    });
    expect(
      declarationsFor('.ogabassey-home-product-card__media')
    ).toMatchObject({
      position: 'relative',
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
});
