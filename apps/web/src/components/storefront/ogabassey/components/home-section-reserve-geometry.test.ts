import { describe, expect, it } from 'vitest';
import {
  OGABASSEY_HOME_DISCOVERY_RESERVE_MIN_HEIGHT_CLASS,
  OGABASSEY_HOME_DISCOVERY_RESERVE_MIN_HEIGHT_PX,
  OGABASSEY_HOME_DISCOVERY_RESERVE_STYLE,
  OGABASSEY_HOME_PRODUCT_RESERVE_MIN_HEIGHT_CLASS,
  OGABASSEY_HOME_PRODUCT_RESERVE_MIN_HEIGHT_PX,
  OGABASSEY_HOME_PRODUCT_RESERVE_STYLE,
} from './home-section-reserve-geometry';

describe('home-section-reserve-geometry', () => {
  it('synchronizes the product reserve Tailwind class and inline minHeight style', () => {
    expect(OGABASSEY_HOME_PRODUCT_RESERVE_MIN_HEIGHT_PX).toBe('1200px');
    expect(OGABASSEY_HOME_PRODUCT_RESERVE_MIN_HEIGHT_CLASS).toBe(
      'min-h-[1200px]'
    );
    expect(OGABASSEY_HOME_PRODUCT_RESERVE_STYLE).toEqual({
      minHeight: '1200px',
    });
  });

  it('synchronizes the discovery reserve Tailwind class and inline minHeight style', () => {
    expect(OGABASSEY_HOME_DISCOVERY_RESERVE_MIN_HEIGHT_PX).toBe('280px');
    expect(OGABASSEY_HOME_DISCOVERY_RESERVE_MIN_HEIGHT_CLASS).toBe(
      'min-h-[280px]'
    );
    expect(OGABASSEY_HOME_DISCOVERY_RESERVE_STYLE).toEqual({
      minHeight: '280px',
    });
  });
});
