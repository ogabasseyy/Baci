import { describe, expect, it } from 'vitest';
import { getCategoryAuthorityNoun } from './get-category-authority-noun';

describe('getCategoryAuthorityNoun', () => {
  it('maps known category slugs to their authority nouns', () => {
    expect(getCategoryAuthorityNoun('smartphones', 'Smartphones')).toEqual({
      titleNoun: 'Phones',
      lowerNoun: 'phones',
    });
    expect(getCategoryAuthorityNoun('laptops', 'Laptops')).toEqual({
      titleNoun: 'Laptops',
      lowerNoun: 'laptops',
    });
  });

  it('normalizes slug casing and whitespace', () => {
    expect(getCategoryAuthorityNoun('  SmartWatches ')).toEqual({
      titleNoun: 'Smartwatches',
      lowerNoun: 'smartwatches',
    });
  });

  it('falls back to the category name for unknown slugs', () => {
    expect(getCategoryAuthorityNoun('accessories', 'Accessories')).toEqual({
      titleNoun: 'Accessories',
      lowerNoun: 'accessories',
    });
    expect(getCategoryAuthorityNoun('accessories')).toEqual({
      titleNoun: 'accessories',
      lowerNoun: 'accessories',
    });
  });
});
