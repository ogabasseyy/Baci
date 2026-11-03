import { describe, expect, it } from 'vitest';
import {
  isNonBrandPlaceholderKey,
  NON_BRAND_PLACEHOLDER_KEYS,
} from './category-hub-brand-placeholder';

describe('isNonBrandPlaceholderKey', () => {
  it('identifies placeholder keys and empty/null values', () => {
    expect(isNonBrandPlaceholderKey(null)).toBe(true);
    expect(isNonBrandPlaceholderKey(undefined)).toBe(true);
    expect(isNonBrandPlaceholderKey('')).toBe(true);
    expect(isNonBrandPlaceholderKey('   ')).toBe(true);
    for (const key of NON_BRAND_PLACEHOLDER_KEYS) {
      expect(isNonBrandPlaceholderKey(key)).toBe(true);
    }
  });

  it('normalizes raw brand labels with whitespace and punctuation', () => {
    expect(isNonBrandPlaceholderKey(' Gaming ')).toBe(true);
    expect(isNonBrandPlaceholderKey('N/A')).toBe(true);
    expect(isNonBrandPlaceholderKey('N / A')).toBe(true);
    expect(isNonBrandPlaceholderKey('No-Brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('Generic Brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('Generic.Brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('No_Brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('No/Brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('Other Brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('Unbranded Product')).toBe(true);
    expect(isNonBrandPlaceholderKey('Unknown Brand')).toBe(true);
  });

  it('identifies suffixed and prefixed placeholder variants', () => {
    expect(isNonBrandPlaceholderKey('unbranded-product')).toBe(true);
    expect(isNonBrandPlaceholderKey('other-brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('unknown-brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('brand-generic')).toBe(true);
    expect(isNonBrandPlaceholderKey('Unbranded Products')).toBe(true);
    expect(isNonBrandPlaceholderKey('Other Brands')).toBe(true);
    expect(isNonBrandPlaceholderKey('Unknown Products')).toBe(true);
    expect(isNonBrandPlaceholderKey('Generic Products')).toBe(true);
    expect(isNonBrandPlaceholderKey('products-generic')).toBe(true);
  });

  it('preserves valid commercial brand names', () => {
    expect(isNonBrandPlaceholderKey('apple')).toBe(false);
    expect(isNonBrandPlaceholderKey('samsung')).toBe(false);
    expect(isNonBrandPlaceholderKey('Apple')).toBe(false);
    expect(isNonBrandPlaceholderKey('Samsung')).toBe(false);
    expect(isNonBrandPlaceholderKey('MSI Gaming')).toBe(false);
  });
});
