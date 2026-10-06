import { describe, expect, it } from 'vitest';
import { resolvePublicProductOption } from './resolve-public-product-option';

describe('public option resolution', () => {
  const parent = {
    price: 100000,
    compare_at_price: 110000,
    condition: 'new',
    manage_stock: true,
    stock_quantity: 4,
  };
  it('uses paired variant price and inventory instead of offer values', () => {
    expect(
      resolvePublicProductOption(parent, {
        variant: { price_override: 120000, stock_quantity: 2 },
        offer: { price: 80000, stock_quantity: 0 },
        condition: 'used',
      })
    ).toEqual({
      price: 120000,
      compareAtPrice: 110000,
      condition: 'used',
      stockQuantity: 2,
      purchasable: true,
    });
  });
  it('inherits parent stock only for nonserialized nullable children', () => {
    expect(
      resolvePublicProductOption(parent, { variant: { stock_quantity: null } })
        .stockQuantity
    ).toBe(4);
    const strict = resolvePublicProductOption(parent, {
      variant: {
        stock_quantity: null,
        inventory_tracking_policy: 'serialized_strict',
      },
    });
    expect(strict.stockQuantity).toBe(0);
    expect(strict.purchasable).toBe(false);
  });
  it('keeps zero overrides and canonical conditions', () => {
    expect(
      resolvePublicProductOption(parent, {
        variant: { price_override: 0, condition: 'uk_used', stock_quantity: 1 },
      })
    ).toMatchObject({ price: 0, condition: 'used' });
  });
  it('accepts the selection price including a resolved modifier', () => {
    expect(
      resolvePublicProductOption(parent, {
        variant: {},
        resolvedVariantPrice: 105000,
      }).price
    ).toBe(105000);
  });
  it('uses parent comparison price for bare offers', () => {
    expect(
      resolvePublicProductOption(parent, {
        offer: { price: 80000, stock_quantity: 1 },
        condition: 'used',
      })
    ).toMatchObject({ price: 80000, compareAtPrice: 110000 });
  });
  it('defaults a missing parent and variant condition to new', () => {
    expect(
      resolvePublicProductOption(
        { ...parent, condition: null },
        { variant: { condition: null } }
      ).condition
    ).toBe('new');
  });
  it('treats an explicit null inventory policy as managed for known option values', () => {
    expect(
      resolvePublicProductOption({
        ...parent,
        manage_stock: null,
        stock_quantity: 0,
      }).purchasable
    ).toBe(false);
  });
});
