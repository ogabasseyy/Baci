import { describe, expect, it } from 'vitest';
import { collectProductSchemaSpecProperties } from './collect-product-schema-spec-properties';
import type { ProductKeySpecs } from './products';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('collectProductSchemaSpecProperties', () => {
  it('collects supported structured and legacy properties', () => {
    const collector = collectProductSchemaSpecProperties(
      makeSeoProduct({
        category: 'Cameras',
        product_key_specs: { main_camera_mp: 24, has_nfc: true },
        specifications: [
          {
            category: 'Features',
            items: [{ label: 'Weather Sealing', value: 'No' }],
          },
        ],
      })
    );

    expect(collector.getProperties()).toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Main Camera',
          value: 'Single 24MP',
        },
        { '@type': 'PropertyValue', name: 'NFC', value: 'Yes' },
        { '@type': 'PropertyValue', name: 'Weather Sealing', value: 'No' },
      ])
    );
  });

  it('checks value presence before card-slot and wireless custom checks', () => {
    const collector = collectProductSchemaSpecProperties(
      makeSeoProduct({
        category: 'Smartphones',
        product_key_specs: {
          has_card_slot: true,
          has_wireless_charging: true,
          card_slot_type: null,
          wireless_charging_watt: undefined,
        } as unknown as ProductKeySpecs,
      })
    );

    const properties = collector.getProperties();
    expect(properties).not.toContainEqual(
      expect.objectContaining({ name: 'Card Slot' })
    );
    expect(properties).not.toContainEqual(
      expect.objectContaining({ name: 'Wireless Charging' })
    );
  });

  it('omits unknown measurements and unverified capability strings from JSON-LD', () => {
    for (const category of ['Action Cameras', 'Smartphones', 'Laptops']) {
      const collector = collectProductSchemaSpecProperties(
        makeSeoProduct({
          category,
          product_key_specs: {
            display_resolution: 'Unknown',
            has_nfc: 'Unknown',
            has_ois: 'Not specified',
          } as unknown as ProductKeySpecs,
        })
      );

      expect(collector.getProperties()).toEqual([]);
    }
  });

  it('drops stale mobile-only camera sections from JSON-LD', () => {
    const collector = collectProductSchemaSpecProperties(
      makeSeoProduct({
        category: 'Cameras',
        specifications: [
          {
            category: 'Selfie Camera',
            items: [{ label: 'Resolution', value: '12MP' }],
          },
        ],
      })
    );

    expect(collector.getProperties()).toEqual([]);
  });

  it('drops taxonomy Radio legacy rows from camera JSON-LD', () => {
    const collector = collectProductSchemaSpecProperties(
      makeSeoProduct({
        category: 'Action Cameras',
        specifications: [
          {
            category: 'Connectivity',
            items: [{ label: 'Radio', value: 'FM Radio' }],
          },
        ],
      })
    );

    expect(collector.getProperties()).toEqual([]);
  });

  it('preserves imaging resolution when display resolution is already keyed', () => {
    const collector = collectProductSchemaSpecProperties(
      makeSeoProduct({
        category: 'Cameras',
        product_key_specs: {
          display_resolution: '3 inches',
        },
        specifications: [
          {
            category: 'Imaging',
            items: [{ label: 'Resolution', value: '24.2 MP' }],
          },
        ],
      })
    );

    expect(collector.getProperties()).toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Display Resolution',
          value: '3 inches',
        },
        {
          '@type': 'PropertyValue',
          name: 'Resolution',
          value: '24.2 MP',
        },
      ])
    );
  });

  it('suppresses legacy specification rows when keyed specs already populated the canonical field', () => {
    const collector = collectProductSchemaSpecProperties(
      makeSeoProduct({
        category: 'Smartphones',
        product_key_specs: { ram_gb: 8 },
        specifications: [
          {
            category: 'Memory',
            items: [{ label: 'RAM', value: '16GB' }],
          },
        ],
      })
    );

    expect(collector.getProperties()).toEqual([
      { '@type': 'PropertyValue', name: 'RAM', value: '8GB' },
    ]);
  });

  it('ignores legacy specification rows with non-string labels', () => {
    const collector = collectProductSchemaSpecProperties(
      makeSeoProduct({
        category: 'Cameras',
        specifications: [
          {
            category: 'Imaging',
            items: [{ label: 123 as unknown as string, value: '48MP' }],
          },
        ],
      })
    );

    expect(collector.getProperties()).toEqual([]);
  });

  it('ignores legacy specification rows with non-string section names', () => {
    const collector = collectProductSchemaSpecProperties(
      makeSeoProduct({
        category: 'Cameras',
        specifications: [
          {
            category: 123 as unknown as string,
            items: [{ label: 'Resolution', value: '48MP' }],
          },
        ],
      })
    );

    expect(collector.getProperties()).toEqual([]);
  });
});
