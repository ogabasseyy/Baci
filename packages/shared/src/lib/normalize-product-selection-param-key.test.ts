import { describe, expect, it } from 'vitest';
import { normalizeProductSelectionParamKey } from './normalize-product-selection-param-key';

describe('normalizeProductSelectionParamKey', () => {
  it('canonicalizes whitespace, hyphens, and case', () => {
    expect(normalizeProductSelectionParamKey('  Storage-Size  ')).toBe(
      'storage_size'
    );
  });

  it('returns an empty key for missing values', () => {
    expect(normalizeProductSelectionParamKey(null)).toBe('');
    expect(normalizeProductSelectionParamKey(undefined)).toBe('');
  });
});
