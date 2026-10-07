import { describe, expect, it } from '@jest/globals';
import type { ProductVariant } from '@/types/product';
import {
  buildSavingsVariantOptionGroups,
  completeSavingsSingleValueSelection,
  resolveSavingsVariant,
  seedSavingsVariantSelection,
  selectSavingsVariantOption,
} from './start-savings-variant-options';

const variants: ProductVariant[] = [
  {
    attributes: { color: 'Black', storage: '128GB' },
    id: 'variant-128-black',
    name: 'iPhone 128GB Black',
    price: 800000,
  },
  {
    attributes: { color: 'White', storage: '128GB' },
    id: 'variant-128-white',
    name: 'iPhone 128GB White',
    price: 800000,
  },
  {
    attributes: { color: 'Black', storage: '256GB' },
    id: 'variant-256-black',
    name: 'iPhone 256GB Black',
    price: 850000,
  },
];

describe('start savings variant options', () => {
  it('groups multi-value axes and sorts storage by capacity', () => {
    const groups = buildSavingsVariantOptionGroups(variants, {});

    expect(groups.map((group) => group.key)).toEqual(['color', 'storage']);
    expect(groups[0]?.label).toBe('Color');
    expect(groups[1]?.values.map((option) => option.value)).toEqual([
      '128GB',
      '256GB',
    ]);
    expect(
      groups.every((group) =>
        group.values.every((option) => option.available && !option.selected)
      )
    ).toBe(true);
  });

  it('skips single-value axes', () => {
    const groups = buildSavingsVariantOptionGroups(
      variants.filter((variant) => variant.id !== 'variant-128-white'),
      {}
    );

    expect(groups.map((group) => group.key)).toEqual(['storage']);
  });

  it('resolves only a unique full match', () => {
    expect(resolveSavingsVariant(variants, {})).toBeNull();
    expect(resolveSavingsVariant(variants, { storage: '128GB' })).toBeNull();
    expect(
      resolveSavingsVariant(variants, {
        color: 'Black',
        storage: '256GB',
      })?.id
    ).toBe('variant-256-black');
  });

  it('toggles options and prunes incompatible axes', () => {
    const selection = selectSavingsVariantOption(
      variants,
      { color: 'White' },
      'storage',
      '256GB'
    );

    expect(selection).toEqual({ storage: '256GB' });

    const toggled = selectSavingsVariantOption(
      variants,
      selection,
      'storage',
      '256GB'
    );

    expect(toggled).toEqual({ storage: '' });
  });

  it('auto-fills axes with a single available value', () => {
    expect(
      completeSavingsSingleValueSelection(variants, { color: 'White' })
    ).toEqual({ color: 'White', storage: '128GB' });
  });

  it('seeds selection from a deep-linked variant id', () => {
    expect(seedSavingsVariantSelection(variants, 'variant-256-black')).toEqual({
      color: 'Black',
      storage: '256GB',
    });
    expect(seedSavingsVariantSelection(variants, 'missing')).toEqual({});
    expect(seedSavingsVariantSelection(variants, null)).toEqual({});
  });

  it('unifies color and colour spellings into one axis', () => {
    const groups = buildSavingsVariantOptionGroups(
      [{ attributes: { colour: 'Black' } }, { attributes: { color: 'White' } }],
      {}
    );

    expect(groups.map((group) => group.key)).toEqual(['color']);
  });
});

it('does not expose hex metadata as a savings choice', () => {
  const withHex = variants.map((variant, index) => ({
    ...variant,
    attributes: { ...variant.attributes, hex: index ? '#FFFFFF' : '#000000' },
  }));
  expect(
    buildSavingsVariantOptionGroups(withHex, {}).map((group) => group.key)
  ).toEqual(['color', 'storage']);
});
