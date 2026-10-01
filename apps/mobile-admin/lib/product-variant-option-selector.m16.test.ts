import { describe, expect, it } from 'vitest';
import type {
  AdminProductVariant,
  VariantAttributes,
} from '@/lib/product-picker-variant-rows';
import {
  buildVariantOptionGroups,
  selectVariantOption,
} from '@/lib/product-variant-option-selector';

function variant(
  id: string,
  attributes: VariantAttributes,
  overrides: Partial<AdminProductVariant> = {}
): AdminProductVariant {
  return {
    condition: 'new',
    cost_price: null,
    has_variants: false,
    id,
    images: [],
    name: `Phone ${id}`,
    parent_product_id: 'product-1',
    price: 1000,
    primary_image: null,
    sku: id.toUpperCase(),
    source: 'structured',
    stock_quantity: 1,
    variant_attributes: attributes,
    ...overrides,
  };
}

describe('buildVariantOptionGroups M16 and selection transitions', () => {
  const variants = [
    variant('variant-1', { color: 'Black', ram: '12GB', storage: '256GB' }),
    variant('variant-2', { color: 'Black', ram: '12GB', storage: '512GB' }),
    variant('variant-3', { color: 'Blue', ram: '12GB', storage: '512GB' }),
  ];

  it('keeps M16 R2 metadata out of the selectable matrix', () => {
    const declaration = {
      condition: ['used'],
      gpu: ['RTX 4070'],
      processor: ['Intel Ultra 7 155H', 'Intel Ultra 9 185H'],
      ram: ['16GB', '32GB'],
      storage: ['1TB'],
    };
    const groups = buildVariantOptionGroups(
      [
        variant(
          'used-16',
          {
            graphics: '8GB RTX 4070 Graphics',
            processor: 'Intel Ultra 7 155H',
            ram: '16GB RAM',
            storage: '1TB SSD',
          },
          { condition: 'used' }
        ),
        variant(
          'new-64',
          {
            camera: 'Webcam',
            graphics: '8GB NVIDIA GeForce RTX 4070 Graphics',
            keyboard: 'Backlit keyboard',
            model_number: 'DYMSR54',
            operating_system: 'Windows 11 Pro',
            processor: 'Intel Core Ultra 7 155H',
            ram: '64GB RAM',
            storage: '1TB SSD',
            wireless: 'WLAN and Bluetooth',
          },
          { condition: 'new' }
        ),
      ],
      {},
      { declaration }
    );

    expect(groups.map((group) => group.key)).toEqual(['condition', 'ram']);
  });

  it('coalesces gpu/graphics aliases to one selectable value per variant', () => {
    const groups = buildVariantOptionGroups(
      [
        variant('variant-1', {
          gpu: 'RTX 4070 8GB',
          graphics: 'NVIDIA GeForce RTX 4060 8GB',
        }),
        variant('variant-2', {
          graphics: 'NVIDIA GeForce RTX 4050 6GB',
        }),
      ],
      {}
    );

    const graphics = groups.find((group) => group.key === 'graphics');
    expect(graphics?.values.map((value) => value.value)).toEqual([
      'NVIDIA GeForce RTX 4060 8GB',
      'NVIDIA GeForce RTX 4050 6GB',
    ]);
  });

  it('drops incompatible earlier selections when a new option is chosen', () => {
    const next = selectVariantOption(
      variants,
      { color: 'Blue', storage: '512GB' },
      'storage',
      '256GB'
    );

    expect(next).toEqual({ storage: '256GB' });
  });

  it('clears an option when its selected value is chosen again', () => {
    const next = selectVariantOption(
      variants,
      { color: 'Blue', storage: '512GB' },
      'storage',
      '512GB'
    );

    expect(next).toEqual({ color: 'Blue', storage: '' });
  });
});
