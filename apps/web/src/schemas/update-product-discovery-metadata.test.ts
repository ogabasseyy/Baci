import { describe, expect, it } from 'vitest';
import { updateProductDiscoveryMetadataSchema as schema } from './update-product-discovery-metadata';
import { expectedRevision } from './update-product-discovery-metadata.test-support';

const valid = {
  productId: '22222222-2222-4222-8222-222222222222',
  expectedRevision,
  metadata: { product_type: 'Smartphones', attributes: { storage_gb: 256 } },
};
describe('updateProductDiscoveryMetadataSchema', () => {
  it('accepts the opaque database revision and canonicalizes only new facts', () => {
    expect(schema.parse(valid)).toEqual({
      ...valid,
      metadata: { ...valid.metadata, product_type: 'phone' },
    });
  });
  it.each([
    undefined,
    null,
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'g'.repeat(64),
    'A'.repeat(64),
    '\u0000',
    '\ud800',
  ])('rejects invalid revisions %j', (expectedRevision) => {
    expect(schema.safeParse({ ...valid, expectedRevision }).success).toBe(
      false
    );
  });
  it('rejects legacy JSON snapshot guards rather than accepting a lossy fallback', () => {
    expect(schema.safeParse({ ...valid, expectedMetadata: null }).success).toBe(
      false
    );
    expect(schema.safeParse({ ...valid, expectedSource: {} }).success).toBe(
      false
    );
  });
  it('requires UUID identities and valid facts', () => {
    expect(schema.safeParse({ ...valid, productId: 'invalid' }).success).toBe(
      false
    );
    expect(schema.safeParse({ ...valid, merchantId: 'invalid' }).success).toBe(
      false
    );
    expect(
      schema.safeParse({ ...valid, merchantId: valid.productId }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        ...valid,
        metadata: { attributes: { storage_gb: '256' } },
      }).success
    ).toBe(false);
  });
});
