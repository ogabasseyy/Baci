import { describe, expect, it } from 'vitest';
import { updateProductDiscoveryMetadataSchema } from './update-product-discovery-metadata';

describe('updateProductDiscoveryMetadataSchema', () => {
  const valid = {
    productId: '22222222-2222-4222-8222-222222222222',
    metadata: {
      product_type: 'Smartphones',
      attributes: { storage_gb: 256, supplier_variant: 'A-1' },
    },
  };

  it('accepts a UUID and validated nested metadata, returning canonical product type', () => {
    expect(updateProductDiscoveryMetadataSchema.parse(valid)).toEqual({
      ...valid,
      metadata: { ...valid.metadata, product_type: 'phone' },
    });
  });

  it('rejects invalid product identifiers and nested metadata', () => {
    expect(
      updateProductDiscoveryMetadataSchema.safeParse({
        ...valid,
        productId: 'p1',
      }).success
    ).toBe(false);
    expect(
      updateProductDiscoveryMetadataSchema.safeParse({
        ...valid,
        metadata: { ...valid.metadata, attributes: { storage_gb: '256' } },
      }).success
    ).toBe(false);
    expect(
      updateProductDiscoveryMetadataSchema.safeParse({ ...valid, extra: true })
        .success
    ).toBe(false);
  });
});
