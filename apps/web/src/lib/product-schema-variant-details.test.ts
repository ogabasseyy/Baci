import { describe, expect, it } from 'vitest';
import {
  buildVariantSchemaName,
  getVariantSchemaColor,
  getVariantSchemaSize,
  isValidMerchantIdentifier,
} from './product-schema-variant-details';

describe('variant schema details', () => {
  it('normalizes known color and size aliases without inventing absent values', () => {
    expect(getVariantSchemaColor({ Colour: ' Silver ' })).toBe('Silver');
    expect(getVariantSchemaColor({ ram: '16GB' })).toBeUndefined();
    expect(getVariantSchemaSize({ storage: '512GB', ram: '16GB' })).toBe(
      '512GB / 16GB'
    );
    expect(
      getVariantSchemaSize({
        storage: 'specification '.repeat(20),
        ram: '32GB',
      })
    ).toBe('32GB');
  });
  it('rejects overlong and whitespace identifiers while preserving valid identifiers', () => {
    expect(isValidMerchantIdentifier('SKU-123')).toBe(true);
    expect(isValidMerchantIdentifier('SKU 123')).toBe(false);
    expect(isValidMerchantIdentifier('X'.repeat(51))).toBe(false);
    expect(isValidMerchantIdentifier(null)).toBe(false);
  });
  it('keeps complete option values within the name limit', () => {
    expect(
      buildVariantSchemaName('Laptop', {
        color: 'Silver',
        spec: 'X'.repeat(200),
        ram: '16GB',
      })
    ).toBe('Laptop - Silver / 16GB');
  });
});
