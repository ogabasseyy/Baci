import { describe, expect, it } from 'vitest';
import { getCategoryFallbackName } from './get-category-fallback-name';

describe('getCategoryFallbackName', () => {
  it.each([
    '%C3%A9lectronique',
    'Électronique',
  ])('preserves accented category names: %s', (slug) => {
    expect(getCategoryFallbackName(slug)).toBe('Électronique');
  });
  it('keeps fallback names deterministic for encoded category slugs', () => {
    expect(getCategoryFallbackName('phones%2Dand%2Dtablets')).toBe(
      'Phones And Tablets'
    );
  });

  it('keeps malformed percent encoding deterministic without throwing', () => {
    expect(getCategoryFallbackName('phones%')).toBe('Phones%');
  });
});
