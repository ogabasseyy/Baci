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

  it('canonicalizes advertised product type aliases while preserving extensible types', () => {
    for (const type of ['smartphone', 'Smartphones', 'Phones']) {
      expect(
        productDiscoveryMetadataSchema.parse({ product_type: type })
          .product_type
      ).toBe('phone');
    }
    expect(
      productDiscoveryMetadataSchema.parse({ product_type: 'Security Camera' })
        .product_type
    ).toBe('security_camera');
  });

  it('requires canonical numeric and text attributes to keep their declared value types', () => {
    for (const attributes of [
      { storage_gb: '256' },
      { ram_gb: '16GB' },
      { color: 12 },
      { connector: 3 },
    ]) {
      expect(
        productDiscoveryMetadataSchema.safeParse({ attributes }).success
      ).toBe(false);
    }
    expect(
      productDiscoveryMetadataSchema.safeParse({
        attributes: { vendor_model_code: 'X-15', supplier_rating: 4 },
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
