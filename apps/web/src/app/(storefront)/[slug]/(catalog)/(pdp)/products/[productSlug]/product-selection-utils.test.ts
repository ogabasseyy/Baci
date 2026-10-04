import { describe, expect, it } from 'vitest';
import type { Product, ProductVariant } from '@/lib/products';
import {
  areSelectionAttributesEqual,
  getAttributeOptions,
  getValidConditionOptions,
  resolveSelectionPricing,
} from './product-selection-utils';

describe('getAttributeOptions', () => {
  it('collects sorted unique values per attribute key', () => {
    const variants = [
      {
        id: 'v1',
        product_id: 'p1',
        merchant_id: 'm1',
        stock_quantity: 5,
        attributes: { storage: '256 GB', color: 'Blue' },
      },
      {
        id: 'v2',
        product_id: 'p1',
        merchant_id: 'm1',
        stock_quantity: 5,
        attributes: { storage: '128 GB', color: 'Blue' },
      },
    ] as ProductVariant[];
    expect(getAttributeOptions(variants)).toEqual([
      { key: 'storage', values: ['128 GB', '256 GB'] },
      { key: 'color', values: ['Blue'] },
    ]);
  });
});

describe('getValidConditionOptions', () => {
  it('canonicalizes aliases and drops unknown grades', () => {
    expect(
      getValidConditionOptions(['uk_used', 'refurbished', 'bogus', 'NEW'])
    ).toEqual(['used', 'open_box', 'new']);
  });
});

describe('areSelectionAttributesEqual', () => {
  it('compares attribute maps by entry, not identity', () => {
    expect(areSelectionAttributesEqual({ a: '1' }, { a: '1', b: '2' })).toBe(
      false
    );
    expect(areSelectionAttributesEqual({ a: '1' }, { a: '2' })).toBe(false);
    expect(areSelectionAttributesEqual({ a: '1' }, { a: '1' })).toBe(true);
  });
});

describe('resolveSelectionPricing', () => {
  const product = {
    price: 100,
    compare_at_price: 120,
    stock: 10,
  } as Product;

  it('charges the matched offer price over variant and parent prices', () => {
    expect(
      resolveSelectionPricing({
        product,
        selectedOffer: { price: 80, stock_quantity: 3 },
        displaySelection: { price: 150 },
        effectiveVariant: { price_override: 140, stock_quantity: 5 },
        isStockManaged: true,
      })
    ).toEqual({
      currentPrice: 80,
      currentCompareAtPrice: 120,
      currentStock: 5,
      isOutOfStock: false,
    });
  });

  it('falls back through variant pricing to the parent price', () => {
    expect(
      resolveSelectionPricing({
        product,
        selectedOffer: null,
        displaySelection: { price: 150, compareAtPrice: 180 },
        effectiveVariant: { price_override: 140, stock_quantity: 5 },
        isStockManaged: true,
      }).currentPrice
    ).toBe(150);
    expect(
      resolveSelectionPricing({
        product,
        selectedOffer: null,
        displaySelection: null,
        effectiveVariant: null,
        isStockManaged: true,
      })
    ).toEqual({
      currentPrice: 100,
      currentCompareAtPrice: 120,
      currentStock: 10,
      isOutOfStock: false,
    });
  });

  it('treats unmanaged stock as unlimited', () => {
    expect(
      resolveSelectionPricing({
        product,
        selectedOffer: null,
        displaySelection: null,
        effectiveVariant: null,
        isStockManaged: false,
      })
    ).toEqual({
      currentPrice: 100,
      currentCompareAtPrice: 120,
      currentStock: Number.POSITIVE_INFINITY,
      isOutOfStock: false,
    });
  });

  it('flags zero managed stock as out of stock', () => {
    expect(
      resolveSelectionPricing({
        product,
        selectedOffer: null,
        displaySelection: null,
        effectiveVariant: { price_override: 140, stock_quantity: 0 },
        isStockManaged: true,
      })
    ).toEqual({
      currentPrice: 140,
      currentCompareAtPrice: 120,
      currentStock: 0,
      isOutOfStock: true,
    });
  });
});
