import { describe, expect, it } from 'vitest';
import type { ProductKeySpecs } from './products';
import { generateProductSchema } from './seo-utils';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('generateProductSchema power mappings', () => {
  it('does not fabricate wireless charging wattage when the value is missing', () => {
    for (const wirelessChargingWatt of [undefined, null]) {
      const schema = generateProductSchema(
        makeSeoProduct({
          category: 'Smartphones',
          product_key_specs: {
            has_wireless_charging: true,
            wireless_charging_watt: wirelessChargingWatt,
          } as ProductKeySpecs,
        }),
        'Ogabassey',
        'NGN',
        'NG'
      );
      const names = (
        (schema.additionalProperty as Record<string, unknown>[] | undefined) ??
        []
      ).map((property) => property.name);

      expect(names).not.toContain('Wireless Charging');
    }
  });

  it('emits verified wireless charging with a supported wattage', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Smartphones',
        product_key_specs: {
          has_wireless_charging: true,
          wireless_charging_watt: 15,
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Wireless Charging',
          value: '15W',
        }),
      ])
    );
  });
});
