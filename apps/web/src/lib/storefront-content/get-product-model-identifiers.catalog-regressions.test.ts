import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers catalog regressions', () => {
  it('preserves configured model-family markers that overlap brand aliases', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Xiaomi and Redmi', 'xiaomi'],
      modelFamilySlug: 'redmi-15',
      productSlugs: ['redmi-15'],
    });
    expect(identifiers).toEqual(['redmi 15']);
  });
  it('keeps Redmi as a discriminator on PDP and comparison contexts', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Redmi'],
      productSlugs: ['redmi-15'],
    });
    expect(identifiers).toEqual(['redmi 15']);
  });
  it('preserves the Redmi Pad family token for tablet products', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Redmi'],
      productSlugs: ['redmi-pad-pro', 'redmi-pad-se'],
    });
    expect(identifiers).toEqual(['redmi pad pro', 'redmi pad se']);
  });
  it('ignores generated numeric collision suffixes', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productSlugs: ['apple-iphone-12-2'],
    });
    expect(identifiers).toEqual(['12']);
  });
  it('does not treat a singular category word as a model identifier', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Nothing'],
      productSlugs: ['nothing-phone'],
    });
    expect(identifiers).toEqual([]);
  });
  it('preserves Xbox Series letter models as family phrases', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'xbox',
      brands: ['Xbox'],
      productSlugs: ['xbox-series-x', 'xbox-series-s'],
    });
    expect(identifiers).toEqual(['series x', 'series s']);
  });
  it('returns an empty list when no brands or product slugs are supplied', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
    });
    expect(identifiers).toEqual([]);
  });
});
