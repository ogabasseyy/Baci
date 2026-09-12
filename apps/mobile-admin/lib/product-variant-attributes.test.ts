import { describe, expect, it } from 'vitest';
import type { AdminProductVariant } from './product-picker-variant-rows';
import {
  getVariantAttributeEntries,
  getVariantAttributeMap,
} from './product-variant-attributes';

function variant(
  variantAttributes: AdminProductVariant['variant_attributes']
): AdminProductVariant {
  return {
    condition: 'new',
    cost_price: null,
    has_variants: false,
    id: 'variant-1',
    images: [],
    name: 'Variant',
    parent_product_id: 'product-1',
    price: 1000,
    primary_image: null,
    sku: null,
    source: 'structured',
    stock_quantity: 1,
    variant_attributes: variantAttributes,
  };
}

describe('product variant attributes', () => {
  it('does not expose color hex aliases from record attributes', () => {
    expect(
      getVariantAttributeEntries(
        variant({
          colorhex: '#000000',
          colourhex: '#ffffff',
          storage: '512GB',
        })
      )
    ).toEqual([
      { key: 'condition', label: 'Condition', value: 'new' },
      { key: 'storage', label: 'Storage', value: '512GB' },
    ]);
  });

  it('does not expose nested color hex metadata paths', () => {
    expect(
      getVariantAttributeEntries(
        variant({
          color: 'Silver',
          specs: {
            color_hex: '#c0c0c0',
            storage: '512GB',
          },
        })
      )
    ).toEqual([
      { key: 'condition', label: 'Condition', value: 'new' },
      { key: 'color', label: 'Color', value: 'Silver' },
    ]);
  });

  it('does not expose color hex aliases from array attributes', () => {
    expect(
      getVariantAttributeMap(
        variant([
          { key: 'color-hex', value: '#000000' },
          { key: 'colour hex', value: '#ffffff' },
          { key: 'RAM', value: '16GB' },
        ])
      )
    ).toEqual({
      condition: 'new',
      ram: '16GB',
    });
  });

  it('normalizes camelCase attribute keys for shared option handling', () => {
    expect(
      getVariantAttributeMap(
        variant({
          displayType: 'FHD Touchscreen',
          storageCapacity: '512GB',
        })
      )
    ).toEqual({
      condition: 'new',
      storage: '512GB',
    });
  });
});
