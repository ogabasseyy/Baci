import { describe, expect, it } from 'vitest';
import { updateProductDiscoveryMetadataSchema } from './update-product-discovery-metadata';

describe('updateProductDiscoveryMetadataSchema', () => {
  const valid = {
    productId: '22222222-2222-4222-8222-222222222222',
    expectedMetadata: null,
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

const schema = updateProductDiscoveryMetadataSchema;
const productId = '11111111-1111-4111-8111-111111111111';
it('accepts raw previous facts independently from new validated facts', () => {
  expect(
    schema.parse({
      productId,
      metadata: { product_type: 'phones' },
      expectedMetadata: { attributes: { ram_gb: '8' } },
    })
  ).toMatchObject({
    metadata: { product_type: 'phone' },
    expectedMetadata: { attributes: { ram_gb: '8' } },
  });
});
it('bounds snapshots and validates merchant identifiers', () => {
  expect(
    schema.safeParse({
      productId,
      metadata: {},
      expectedMetadata: { value: 'x'.repeat(65537) },
    }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      productId,
      metadata: {},
      merchantId: 'other',
      expectedMetadata: null,
    }).success
  ).toBe(false);
});

it('accepts explicit UUID merchant scope for server authorization', () => {
  expect(
    schema.parse({
      productId,
      metadata: {},
      merchantId: productId,
      expectedMetadata: null,
    })
  ).toMatchObject({ merchantId: productId });
});

it('rejects omitted snapshots instead of allowing unguarded overwrites', () => {
  expect(schema.safeParse({ productId, metadata: {} }).success).toBe(false);
  expect(
    schema.safeParse({ productId, metadata: {}, expectedMetadata: null })
      .success
  ).toBe(true);
});

it('bounds Unicode snapshots in UTF-8 bytes rather than code units', () => {
  const expectedMetadata = { source: '漢'.repeat(22000) };
  expect(JSON.stringify(expectedMetadata).length).toBeLessThan(65536);
  expect(
    schema.safeParse({ productId, metadata: {}, expectedMetadata }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      productId,
      metadata: {},
      expectedMetadata: { source: '漢'.repeat(21000) },
    }).success
  ).toBe(true);
});
