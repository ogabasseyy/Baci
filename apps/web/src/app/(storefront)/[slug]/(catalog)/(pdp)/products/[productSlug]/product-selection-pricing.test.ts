import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { resolveSelectionPricing } from './product-selection-pricing';

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

  it('inherits parent stock for a null-quantity selected offer', () => {
    expect(
      resolveSelectionPricing({
        product,
        selectedOffer: { price: 80, stock_quantity: null },
        displaySelection: null,
        effectiveVariant: null,
        isStockManaged: true,
      })
    ).toEqual({
      currentPrice: 80,
      currentCompareAtPrice: 120,
      currentStock: 10,
      isOutOfStock: false,
    });
  });
});
