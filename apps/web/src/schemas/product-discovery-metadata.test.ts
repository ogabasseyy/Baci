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

  it('bounds serialized metadata by UTF-8 bytes for localized values', () => {
    const localizedMetadata = {
      compatible_with: Array.from({ length: 50 }, () => '漢'.repeat(100)),
    };
    const serialized = JSON.stringify(localizedMetadata);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(
      16_384
    );
    expect(
      productDiscoveryMetadataSchema.safeParse(localizedMetadata).success
    ).toBe(true);

    const oversizedLocalizedMetadata = {
      ...localizedMetadata,
      attributes: Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          `supplier_note_${index}`,
          '語'.repeat(100),
        ])
      ),
    };
    expect(
      new TextEncoder().encode(JSON.stringify(oversizedLocalizedMetadata))
        .byteLength
    ).toBeGreaterThan(16_384);
    expect(
      productDiscoveryMetadataSchema.safeParse(oversizedLocalizedMetadata)
        .success
    ).toBe(false);
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
  it('includes PostgreSQL separator and exponent expansion in the storage bound', () => {
    const value = {
      compatible_with: Array.from({ length: 50 }, () => '語'.repeat(100)),
      attributes: Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [`capacity_${index}`, 1e100])
      ),
    };
    expect(
      new TextEncoder().encode(JSON.stringify(value)).byteLength
    ).toBeLessThan(16_384);
    expect(productDiscoveryMetadataSchema.safeParse(value).success).toBe(false);
    expect(
      productDiscoveryMetadataSchema.safeParse({ model: 'bad\u0000model' })
        .success
    ).toBe(false);
  });
});
