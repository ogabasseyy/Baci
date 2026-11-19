import { describe, expect, it } from 'vitest';
import { scoreBlogPostBrandAffinity } from './blog-post-brand-affinity';

describe('scoreBlogPostBrandAffinity', () => {
  it('boosts posts that share a canonical brand family across sub-brands', () => {
    expect(
      scoreBlogPostBrandAffinity(
        ['Tecno Camon Slim Price in Nigeria'],
        ['Spark 40 Pro battery life']
      )
    ).toBe(20);
    expect(
      scoreBlogPostBrandAffinity(
        ['Redmi Note 15 Pro review'],
        ['Poco X8 Pro Max gaming performance']
      )
    ).toBe(20);
  });

  it('preserves two-character brands such as HP and LG in multiword phrases', () => {
    expect(
      scoreBlogPostBrandAffinity(
        ['HP ProBook 450 G10 Price in Nigeria'],
        ['HP ZBook Firefly 14 workstation review']
      )
    ).toBe(20);
    expect(
      scoreBlogPostBrandAffinity(
        ['LG C4 OLED TV review'],
        ['LG UltraGear gaming monitor guide']
      )
    ).toBe(20);
    expect(
      scoreBlogPostBrandAffinity(
        ['HP ProBook 450 G10 Price in Nigeria'],
        ['Dell XPS 13 battery guide']
      )
    ).toBe(-8);
  });

  it('penalizes candidates with disjoint brand families', () => {
    expect(
      scoreBlogPostBrandAffinity(['Tecno Camon 50'], ['iPhone 17 Pro'])
    ).toBe(-8);
  });

  it('returns 0 when either post has no brand signal', () => {
    expect(
      scoreBlogPostBrandAffinity(
        ['Smartphone battery calibration guide'],
        ['iPhone 17 Pro']
      )
    ).toBe(0);
  });
});
