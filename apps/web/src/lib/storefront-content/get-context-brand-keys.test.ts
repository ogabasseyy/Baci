import { describe, expect, it } from 'vitest';
import { getContextBrandKeys } from './get-context-brand-keys';

describe('getContextBrandKeys', () => {
  it('derives a canonical brand from a branded product name when context is absent', () => {
    const brandKeys = getContextBrandKeys(undefined, ['Apple iPhone 15'], {
      apple: ['apple', 'iphone'],
      samsung: ['samsung', 'galaxy'],
    });

    expect(brandKeys).toEqual(['apple']);
  });

  it('keeps explicit canonical context brands ahead of product-name aliases', () => {
    const brandKeys = getContextBrandKeys(['Xiaomi'], ['Xiaomi 14T'], {
      redmi: ['redmi', 'xiaomi'],
      xiaomi: ['xiaomi', 'redmi'],
    });

    expect(brandKeys).toEqual(['xiaomi']);
  });

  it('includes a configured sibling brand found in an explicit-brand product name', () => {
    const brandKeys = getContextBrandKeys(['Xiaomi'], ['Redmi Note 13'], {
      redmi: ['redmi'],
      xiaomi: ['xiaomi', 'redmi'],
    });

    expect(brandKeys).toEqual(['xiaomi', 'redmi']);
  });

  it('resolves an explicit composite brand to its canonical key', () => {
    const brandKeys = getContextBrandKeys(['Google Pixel'], undefined, {
      google: ['google', 'pixel'],
      samsung: ['samsung', 'galaxy'],
    });

    expect(brandKeys).toEqual(['google']);
  });

  it('preserves unconfigured explicit brands alongside canonicalized brands', () => {
    const brandKeys = getContextBrandKeys(['Apple', 'Nothing'], undefined, {
      apple: ['apple', 'iphone'],
      samsung: ['samsung', 'galaxy'],
    });

    expect(brandKeys).toEqual(['apple', 'nothing']);
  });

  it('does not promote a compatibility brand from an explicitly branded product name', () => {
    const brandKeys = getContextBrandKeys(
      ['Samsung'],
      ['Samsung Case for Apple iPhone 15'],
      {
        apple: ['apple', 'iphone'],
        samsung: ['samsung', 'galaxy'],
      }
    );

    expect(brandKeys).toEqual(['samsung']);
  });
});
