import { describe, expect, it } from 'vitest';
import { OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY } from './home-section-reserve-geometry';

describe('home-section-reserve-geometry', () => {
  it('synchronizes the product reserve Tailwind class and inline minHeight style', () => {
    expect(OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY.product.minHeightClass).toBe(
      `min-h-[${OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY.product.style.minHeight}]`
    );
    expect(OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY.product.style).toEqual({
      minHeight: '1200px',
    });
  });

  it('synchronizes the discovery reserve Tailwind class and inline minHeight style', () => {
    expect(
      OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY.discovery.minHeightClass
    ).toBe(
      `min-h-[${OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY.discovery.style.minHeight}]`
    );
    expect(OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY.discovery.style).toEqual({
      minHeight: '280px',
    });
  });
});
