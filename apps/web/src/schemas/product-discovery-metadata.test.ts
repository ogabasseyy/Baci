import { describe, expect, it } from 'vitest';
import { productDiscoveryMetadataSchema } from './product-discovery-metadata';

describe('productDiscoveryMetadataSchema', () => {
  it('accepts the supported public metadata shape', () => {
    expect(
      productDiscoveryMetadataSchema.safeParse({
        product_type: 'Laptop',
        model: 'ThinkPad X1 Carbon',
        compatible_with: ['USB-C dock', '65W charger'],
        attributes: { ram_gb: 16, storage_gb: 512, color: 'Black' },
      }).success
    ).toBe(true);
  });

  it('rejects unknown fields, malformed attribute keys, and invalid numeric values', () => {
    for (const value of [
      { arbitrary: 'value' },
      { attributes: { 'Bad-Key': 'value' } },
      { attributes: { ram_gb: -1 } },
      { attributes: { ram_gb: Number.NaN } },
      { attributes: { ram_gb: Number.POSITIVE_INFINITY } },
      {
        compatible_with: Array.from(
          { length: 51 },
          (_, index) => `item-${index}`
        ),
      },
    ]) {
      expect(productDiscoveryMetadataSchema.safeParse(value).success).toBe(
        false
      );
    }
  });
});
