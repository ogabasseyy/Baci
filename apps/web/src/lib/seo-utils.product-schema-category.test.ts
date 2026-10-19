import { describe, expect, it } from 'vitest';
import { generateProductSchema } from './seo-utils';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('generateProductSchema category-specific fields', () => {
  it('retains the existing negative phone and tablet spec behavior', () => {
    for (const category of ['Smartphones', 'Tablets']) {
      const schema = generateProductSchema(
        makeSeoProduct({
          category,
          product_key_specs: { has_5g: false },
        }),
        'TestStore',
        'USD',
        'NG'
      );

      expect(schema.additionalProperty).toEqual(
        expect.arrayContaining([
          { '@type': 'PropertyValue', name: '5G Support', value: 'No' },
        ])
      );
    }
  });

  it('uses a slug-only camera join before stale text in Product and ProductGroup schemas', () => {
    const product = makeSeoProduct({
      category: 'Smartphones',
      categories: { slug: 'action-cameras' },
      product_key_specs: { main_camera_mp: 40, has_5g: true },
      variants: [
        {
          id: 'camera-variant',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { color: 'Black' },
          stock_quantity: 1,
        },
      ],
    });
    const schemas = [
      generateProductSchema(
        { ...product, variants: [] },
        'Ogabassey',
        'NGN',
        'NG'
      ),
      generateProductSchema(product, 'Ogabassey', 'NGN', 'NG'),
    ];

    for (const schema of schemas) {
      expect(schema.category).toBe('action-cameras');
      expect(schema.additionalProperty).toEqual(
        expect.arrayContaining([
          {
            '@type': 'PropertyValue',
            name: 'Main Camera',
            value: 'Single 40MP',
          },
        ])
      );
      expect(schema.additionalProperty).not.toEqual(
        expect.arrayContaining([
          { '@type': 'PropertyValue', name: '5G Support', value: 'Yes' },
        ])
      );
    }
    expect(schemas[1]?.['@type']).toBe('ProductGroup');
  });

  it('keeps verified cellular laptop capabilities while excluding stale phone OS and camera fields', () => {
    const product = makeSeoProduct({
      category: 'Laptops',
      product_key_specs: {
        chipset: 'Intel Core Ultra 7',
        ram_gb: 32,
        has_5g: true,
        has_nfc: true,
        sim_type: 'eSIM',
        has_headphone_jack: false,
        android_version: '16',
        main_camera_mp: 50,
        front_camera_mp: 12,
      },
      variants: [
        {
          id: 'laptop-variant',
          product_id: 'test-123',
          merchant_id: 'm1',
          attributes: { ram: '32GB' },
          stock_quantity: 1,
        },
      ],
    });
    const schemas = [
      generateProductSchema(
        { ...product, variants: [] },
        'Ogabassey',
        'NGN',
        'NG'
      ),
      generateProductSchema(product, 'Ogabassey', 'NGN', 'NG'),
    ];

    for (const schema of schemas) {
      const properties = schema.additionalProperty as Record<string, unknown>[];
      expect(properties).toEqual(
        expect.arrayContaining([
          {
            '@type': 'PropertyValue',
            name: 'Chipset',
            value: 'Intel Core Ultra 7',
          },
          { '@type': 'PropertyValue', name: 'RAM', value: '32GB' },
          { '@type': 'PropertyValue', name: '5G Support', value: 'Yes' },
          { '@type': 'PropertyValue', name: 'NFC', value: 'Yes' },
          { '@type': 'PropertyValue', name: 'SIM Type', value: 'eSIM' },
          {
            '@type': 'PropertyValue',
            name: '3.5mm Headphone Jack',
            value: 'No',
          },
        ])
      );
      const propertyNames = properties.map((property) => property.name);
      for (const excludedName of [
        'Operating System',
        'Main Camera',
        'Selfie Camera',
      ]) {
        expect(propertyNames).not.toContain(excludedName);
      }
    }
    expect(schemas[1]?.['@type']).toBe('ProductGroup');
  });
});
