import { describe, expect, it } from 'vitest';
import { updateProductDiscoveryMetadataSchema } from './update-product-discovery-metadata';
import { expectedSource } from './update-product-discovery-metadata.test-support';

describe('updateProductDiscoveryMetadataSchema', () => {
  const valid = {
    productId: '22222222-2222-4222-8222-222222222222',
    expectedMetadata: null,
    expectedSource,
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
      expectedSource,
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
      expectedSource,
      metadata: {},
      expectedMetadata: { value: 'x'.repeat(65537) },
    }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      productId,
      expectedSource,
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
      expectedSource,
      metadata: {},
      merchantId: productId,
      expectedMetadata: null,
    })
  ).toMatchObject({ merchantId: productId });
});

it('rejects omitted snapshots instead of allowing unguarded overwrites', () => {
  expect(
    schema.safeParse({ productId, expectedSource, metadata: {} }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      productId,
      expectedSource,
      metadata: {},
      expectedMetadata: null,
    }).success
  ).toBe(true);
});

it('bounds Unicode snapshots in UTF-8 bytes rather than code units', () => {
  const expectedMetadata = { source: '漢'.repeat(22000) };
  expect(JSON.stringify(expectedMetadata).length).toBeLessThan(65536);
  expect(
    schema.safeParse({
      productId,
      expectedSource,
      metadata: {},
      expectedMetadata,
    }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      productId,
      expectedSource,
      metadata: {},
      expectedMetadata: { source: '漢'.repeat(21000) },
    }).success
  ).toBe(true);
});

it('rejects excessive snapshot depth safely before recursive JSON validation', () => {
  let nested: unknown = 'leaf';
  for (let index = 0; index < 64; index++) nested = [nested];
  expect(() =>
    schema.safeParse({
      productId,
      expectedSource,
      metadata: {},
      expectedMetadata: { nested },
    })
  ).not.toThrow();
  expect(
    schema.safeParse({
      productId,
      expectedSource,
      metadata: {},
      expectedMetadata: { nested },
    }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      productId,
      expectedSource,
      metadata: {},
      expectedMetadata: { nested: [['leaf']] },
    }).success
  ).toBe(true);
});

it.each([
  '\u0000',
  '\ud800',
  '\udc00',
])('rejects PostgreSQL-invalid snapshot strings %j in nested values and keys', (value) => {
  for (const snapshot of [
    { nested: [value] },
    { nested: { [value]: 'value' } },
  ]) {
    expect(
      schema.safeParse({
        productId,
        expectedSource,
        metadata: {},
        expectedMetadata: snapshot,
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        productId,
        expectedSource: { ...expectedSource, metadata: snapshot },
        metadata: {},
        expectedMetadata: null,
      }).success
    ).toBe(false);
  }
});
it('preserves valid surrogate pairs and raw source identity, and requires every source field', () => {
  const raw = { nested: ['🎉', 'A\u0301'] };
  expect(
    schema.parse({
      productId,
      expectedSource,
      metadata: {},
      expectedMetadata: raw,
    }).expectedMetadata
  ).toEqual(raw);
  expect(
    schema.safeParse({ productId, metadata: {}, expectedMetadata: null })
      .success
  ).toBe(false);
  expect(
    schema.safeParse({
      productId,
      expectedSource: { ...expectedSource, extra: true },
      metadata: {},
      expectedMetadata: null,
    }).success
  ).toBe(false);
  const { color: omitted, ...incomplete } = expectedSource;
  expect(omitted).toBeNull();
  expect(
    schema.safeParse({
      productId,
      expectedSource: incomplete,
      metadata: {},
      expectedMetadata: null,
    }).success
  ).toBe(false);
});
