import { describe, expect, it } from 'vitest';
import { cssColorTokenSchema, isValidCssColorToken } from './css-color-token';

describe('css-color-token', () => {
  it('accepts hex, modern/legacy rgb & hsl, and oklch color tokens', () => {
    for (const valid of [
      '#fff',
      '#0f172a',
      '#0f172acc',
      'rgb(15 23 42)',
      'rgba(15, 23, 42, 0.8)',
      'rgb(10% 20% 30% / 50%)',
      'hsl(222 47% 11%)',
      'hsla(222deg, 47%, 11%, 0.9)',
      'oklch(0.62 0.19 259.8 / 85%)',
    ]) {
      expect(isValidCssColorToken(valid)).toBe(true);
      expect(cssColorTokenSchema.safeParse(valid).success).toBe(true);
    }
  });

  it('rejects CSS injection characters, comments, url() functions, and malformed color syntax', () => {
    for (const invalid of [
      'red; background:url(https://evil.example)',
      '#fff}',
      'hsl(222 47% 11%) /* comment */',
      'url("/assets/hero")',
      'var(--other)',
      '#12',
      'rgb(10, 20%, 30)',
    ]) {
      expect(isValidCssColorToken(invalid)).toBe(false);
      expect(cssColorTokenSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
