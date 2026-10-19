import { describe, expect, it } from 'vitest';
import { MOBILE_HERO_IMAGE_SIZES } from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { deriveControlHeroHint } from './lab-store-hero-hint';

describe('deriveControlHeroHint', () => {
  it('derives a stable hint from the staged original URL', () => {
    const input = {
      alt: 'hero-s0 lab hero',
      stagedOriginalUrl: '/__pilot/originals/hero.png',
    };
    const first = deriveControlHeroHint(input);
    expect(first.href).toContain('/__pilot/originals/hero.png');
    expect(first.imageSizes).toBe(MOBILE_HERO_IMAGE_SIZES);
    expect(first.imageSrcSet).toContain('/__pilot/originals/hero.png');
    // Deterministic: the control arm must preload exactly what the
    // original renderer paints, on every render.
    expect(deriveControlHeroHint(input)).toEqual(first);
  });

  it('varies the hint with the staged URL, never the alt text', () => {
    const left = deriveControlHeroHint({
      alt: 'alt one',
      stagedOriginalUrl: '/__pilot/originals/a.png',
    });
    const right = deriveControlHeroHint({
      alt: 'alt two',
      stagedOriginalUrl: '/__pilot/originals/b.png',
    });
    expect(left.imageSrcSet).not.toBe(right.imageSrcSet);
  });
});
