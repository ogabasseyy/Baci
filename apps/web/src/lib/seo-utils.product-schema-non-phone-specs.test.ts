import { describe, expect, it } from 'vitest';
import type { Product } from './products';
import { generateProductSchema } from './seo-utils';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('generateProductSchema non-phone specifications', () => {
  it('omits phone-only camera negatives while retaining verified legacy camera specs', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        name: 'Canon EOS R5 Mark II',
        category: 'Cameras',
        product_key_specs: {
          has_5g: false,
          has_nfc: false,
          has_stereo_speakers: false,
          has_headphone_jack: false,
          card_slot_type: 'No',
        },
        specifications: [
          {
            category: 'Key Features',
            items: [
              { label: 'Sensor', value: '45MP full-frame CMOS' },
              { label: 'Video', value: '8K 60p RAW' },
              { label: 'Card Slot', value: 'No' },
            ],
          },
        ],
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );
    const properties = schema.additionalProperty as Record<string, unknown>[];

    for (const property of [
      { '@type': 'PropertyValue', name: '5G Support', value: 'No' },
      { '@type': 'PropertyValue', name: 'NFC', value: 'No' },
      { '@type': 'PropertyValue', name: 'Card Slot', value: 'No' },
    ]) {
      expect(properties).not.toContainEqual(property);
    }
    expect(properties).toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Sensor',
          value: '45MP full-frame CMOS',
        },
        { '@type': 'PropertyValue', name: 'Video', value: '8K 60p RAW' },
      ])
    );
  });

  it('deduplicates overlapping key-spec and legacy Product properties', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Cameras',
        product_key_specs: {
          rear_camera_video: '8K RAW',
          has_5g: false,
        },
        specifications: [
          {
            category: 'Imaging',
            items: [
              { label: 'Video Recording', value: '8K RAW' },
              { label: 'Sensor', value: '45MP full-frame CMOS' },
            ],
          },
        ],
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );
    const properties = schema.additionalProperty as Record<string, unknown>[];

    expect(
      properties.filter(
        (property) =>
          property.name === 'Video Recording' && property.value === '8K RAW'
      )
    ).toHaveLength(1);
  });

  it('preserves meaningful negative non-phone facts in Product schema', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Cameras',
        specifications: [
          {
            category: 'Features',
            items: [
              { label: 'Weather Sealing', value: 'No' },
              { label: 'Requires Assembly', value: 'No' },
              { label: 'Built-in Flash', value: 'No' },
              { label: 'NFC', value: 'No' },
            ],
          },
        ],
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).toEqual(
      expect.arrayContaining([
        { '@type': 'PropertyValue', name: 'Weather Sealing', value: 'No' },
        { '@type': 'PropertyValue', name: 'Requires Assembly', value: 'No' },
        { '@type': 'PropertyValue', name: 'Built-in Flash', value: 'No' },
      ])
    );
    expect(schema.additionalProperty).not.toEqual(
      expect.arrayContaining([
        { '@type': 'PropertyValue', name: 'NFC', value: 'No' },
      ])
    );
  });

  it('emits verified positive NFC and OIS for camera Product schema', () => {
    const verifiedSchema = generateProductSchema(
      makeSeoProduct({
        category: 'Action Cameras',
        product_key_specs: { has_nfc: true, has_ois: true },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );
    const unsupportedSchemas = [
      generateProductSchema(
        makeSeoProduct({
          category: 'Action Cameras',
          product_key_specs: { has_nfc: false, has_ois: false },
        }),
        'Ogabassey',
        'NGN',
        'NG'
      ),
      generateProductSchema(
        makeSeoProduct({
          category: 'Action Cameras',
          product_key_specs: {
            has_nfc: 'N/A',
            has_ois: 'N/A',
          } as unknown as NonNullable<Product['product_key_specs']>,
        }),
        'Ogabassey',
        'NGN',
        'NG'
      ),
    ];

    expect(verifiedSchema.additionalProperty).toEqual(
      expect.arrayContaining([
        { '@type': 'PropertyValue', name: 'NFC', value: 'Yes' },
        { '@type': 'PropertyValue', name: 'OIS', value: 'Yes' },
      ])
    );
    for (const unsupportedSchema of unsupportedSchemas) {
      for (const name of ['NFC', 'OIS']) {
        expect(unsupportedSchema.additionalProperty).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name })])
        );
      }
    }
  });
});
