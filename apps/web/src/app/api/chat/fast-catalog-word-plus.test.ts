import { describe, expect, it } from 'vitest';
import { catalogMatchesModel } from './fast-catalog-model';

describe('word-form Plus product matching', () => {
  it.each([
    ['Samsung Galaxy Buds Plus', 'Samsung Galaxy Buds Plus Battery'],
    ['Samsung Galaxy Buds Plus', 'Samsung Galaxy Buds Plus Charging Dock'],
    ['Samsung Galaxy Buds Plus', 'Battery for Samsung Galaxy Buds Plus'],
    [
      'Samsung Galaxy Buds Plus charging case',
      'Samsung Galaxy Buds Plus Charging Case Silicone Cover',
    ],
  ])('does not present a different part for %s', (query, name) => {
    expect(catalogMatchesModel(query, name, 'Samsung')).toBe(false);
  });

  it('accepts an explicitly requested charging case', () => {
    expect(
      catalogMatchesModel(
        'Samsung Galaxy Buds Plus charging case',
        'Samsung Galaxy Buds Plus Charging Case',
        'Samsung'
      )
    ).toBe(true);
  });
});
