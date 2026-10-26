import { describe, expect, it } from 'vitest';
import {
  jumiaAttributeSetParamSchema,
  jumiaBrandMetadataSchema,
  jumiaCategoryMetadataSchema,
  jumiaDestinationContextSchema,
  jumiaDestinationQuerySchema,
} from './metadata-query';

const id = '11111111-1111-4111-8111-111111111111';
describe('Jumia exact metadata query schemas', () => {
  it.each([
    [jumiaBrandMetadataSchema, { brands: [] }],
    [jumiaCategoryMetadataSchema, { categories: [] }],
  ])('retains legacy catalogs but never accepts verified destination availability', (schema, catalog) => {
    expect(schema.safeParse(catalog).success).toBe(true);
    const availability = { scope: 'provider-wide', destinationVerified: false };
    expect(schema.parse({ ...catalog, availability })).toEqual({
      ...catalog,
      availability,
    });
    expect(
      schema.safeParse({
        ...catalog,
        availability: { ...availability, destinationVerified: true },
      }).success
    ).toBe(false);
  });
  it('accepts only a complete UUID destination and UUID attribute set', () => {
    expect(
      jumiaDestinationQuerySchema.safeParse({
        merchantId: id,
        integrationId: id,
      }).success
    ).toBe(true);
    expect(
      jumiaAttributeSetParamSchema.safeParse({ attributeSetId: id }).success
    ).toBe(true);
  });
  it.each([
    {},
    { merchantId: id },
    { merchantId: id, integrationId: 'other' },
    { merchantId: 'other', integrationId: id },
  ])('rejects incomplete or invalid destination %o', (input) => {
    expect(jumiaDestinationQuerySchema.safeParse(input).success).toBe(false);
  });
  it('rejects non-UUID set paths', () => {
    expect(
      jumiaAttributeSetParamSchema.safeParse({ attributeSetId: '123' }).success
    ).toBe(false);
  });
  it('accepts an empty authorized context but rejects incomplete client choices', () => {
    expect(
      jumiaDestinationContextSchema.safeParse({ businessClients: [] }).success
    ).toBe(true);
    expect(
      jumiaDestinationContextSchema.safeParse({
        businessClients: [{ code: 'jumia-ng' }],
      }).success
    ).toBe(false);
    expect(
      jumiaDestinationContextSchema.safeParse({
        businessClients: [
          { code: 'jumia-ng', name: 'Nigeria', countryCode: 'NG' },
        ],
      }).success
    ).toBe(true);
  });
});
