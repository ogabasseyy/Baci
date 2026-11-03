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
    for (const key of NON_BRAND_PLACEHOLDER_KEYS) {
      expect(isNonBrandPlaceholderKey(key)).toBe(true);
    }
    expect(isNonBrandPlaceholderKey('unknown')).toBe(true);
    expect(isNonBrandPlaceholderKey('no-brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('n-a')).toBe(true);
    expect(isNonBrandPlaceholderKey('na')).toBe(true);
    expect(isNonBrandPlaceholderKey('generic-brand')).toBe(true);
    expect(isNonBrandPlaceholderKey('apple')).toBe(false);
    expect(isNonBrandPlaceholderKey('samsung')).toBe(false);
  });
});
