import { describe, expect, it } from 'vitest';
import { generateProductSchema } from './seo-utils';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('generateProductSchema custom property values', () => {
  it('keeps a legitimate zero scalar on a merchant-defined custom property', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Cameras',
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          additionalProperty: {
            '@type': 'PropertyValue',
            name: 'Minimum operating temperature',
            value: 0,
            unitCode: 'CEL',
          },
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Minimum operating temperature',
          value: 0,
          unitCode: 'CEL',
        },
      ])
    );
  });

  it('rejects propertyID-only phone specs from accessory product schema markup', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Phone Cases',
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          additionalProperty: {
            '@type': 'PropertyValue',
            propertyID: 'ram_gb',
            value: '16GB',
          },
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).toBeUndefined();
  });

  it('rejects propertyID-only capability specs from accessory product schema markup', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Phone Cases',
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          additionalProperty: {
            '@type': 'PropertyValue',
            propertyID: 'has_5g',
            value: true,
          },
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).toBeUndefined();
  });

  it('preserves propertyID-only negative custom properties without a canonical key', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Kitchen',
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          additionalProperty: {
            '@type': 'PropertyValue',
            propertyID: 'dishwasher_safe',
            value: false,
          },
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          propertyID: 'dishwasher_safe',
          value: false,
        },
      ])
    );
  });

  it('preserves propertyID-only negative custom properties when name is blank', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Kitchen',
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          additionalProperty: {
            '@type': 'PropertyValue',
            name: '',
            propertyID: 'dishwasher_safe',
            value: false,
          },
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: '',
          propertyID: 'dishwasher_safe',
          value: false,
        },
      ])
    );
  });

  it('preserves one-sided custom PropertyValue ranges in product schema markup', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Cameras',
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          additionalProperty: {
            '@type': 'PropertyValue',
            name: 'Maximum operating temperature',
            maxValue: 45,
            unitCode: 'CEL',
          },
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Maximum operating temperature',
          maxValue: 45,
          unitCode: 'CEL',
        },
      ])
    );
  });
});
