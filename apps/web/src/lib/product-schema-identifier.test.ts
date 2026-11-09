import { describe, expect, it } from 'vitest';
import { isValidMerchantIdentifier } from './product-schema-identifier';

describe('identifier', () => {
  it('rejects overlong, whitespace, and URL-delimiter identifiers while preserving valid identifiers', () => {
    expect(isValidMerchantIdentifier('SKU-123')).toBe(true);
    expect(isValidMerchantIdentifier('SKU 123')).toBe(false);
    expect(isValidMerchantIdentifier('SKU/123')).toBe(false);
    expect(isValidMerchantIdentifier('SKU?123')).toBe(false);
    expect(isValidMerchantIdentifier('SKU#123')).toBe(false);
    expect(isValidMerchantIdentifier('X'.repeat(51))).toBe(false);
    expect(isValidMerchantIdentifier(null)).toBe(false);
  });
});
