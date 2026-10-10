import { describe, expect, it } from 'vitest';
import { THEME_COLOR_NAMES } from './review-handoff-theme-colors';

describe('THEME_COLOR_NAMES', () => {
  it('covers the shadcn palette and storefront tokens', () => {
    for (const name of [
      'foreground',
      'primary-foreground',
      'muted',
      'store-primary-text',
      'store-rating',
    ]) {
      expect(THEME_COLOR_NAMES.has(name)).toBe(true);
    }
    // Palette shades and non-colors resolve elsewhere, never here.
    for (const name of ['red-500', 'transparent', 'center', 'sm']) {
      expect(THEME_COLOR_NAMES.has(name)).toBe(false);
    }
  });
});
