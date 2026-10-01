import { describe, expect, it } from 'vitest';
import { getProductVariantIdentity } from './transaction-review-discount-helpers';

describe('getProductVariantIdentity', () => {
  it('returns a stable identity for a product and nullable variant', () => {
    expect(getProductVariantIdentity('product-1', null)).toBe(
      '["product-1",null]'
    );
    expect(getProductVariantIdentity('product-1', 'variant-1')).toBe(
      '["product-1","variant-1"]'
    );
  });

  it('rejects empty product ids and malformed variant ids', () => {
    expect(getProductVariantIdentity('', null)).toBeNull();
    expect(getProductVariantIdentity('  ', null)).toBeNull();
    expect(getProductVariantIdentity('product-1', 1)).toBeNull();
    expect(getProductVariantIdentity('product-1', undefined)).toBeNull();
  });
});
