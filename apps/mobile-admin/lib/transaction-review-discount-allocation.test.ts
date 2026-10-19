import { buildTransactionDiscountLineKey } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getDiscountedTransactionUnitPrices } from './transaction-review-discount';

describe('persisted transaction discount allocations', () => {
  it('applies the persisted merchandise reduction without VAT relief', () => {
    const items = [
      {
        price: 100,
        quantity: 1,
        line_id: 1,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 2.15, {
      lineDiscounts: [{ lineId: 1, merchandiseDiscount: 2, vatRelief: 0.15 }],
    });

    expect(prices).toEqual([98]);
  });

  it('does not redistribute a negotiated line discount to full-price merchandise', () => {
    const items = [
      { line_id: 1, price: 100, quantity: 1 },
      { line_id: 2, price: 200, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 10, {
      lineDiscounts: [
        { lineId: 1, merchandiseDiscount: 10, vatRelief: 0 },
        null,
      ],
    });

    expect(prices).toEqual([90, 200]);
  });

  it('matches persisted allocations by line id after relation rows are reordered', () => {
    const items = [
      { line_id: 2, price: 200, quantity: 1 },
      { line_id: 1, price: 100, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 30, {
      lineDiscounts: [
        { lineId: 1, merchandiseDiscount: 10, vatRelief: 0 },
        { lineId: 2, merchandiseDiscount: 20, vatRelief: 0 },
      ],
    });

    expect(prices).toEqual([180, 90]);
  });

  it('matches version-3 allocations by persisted product and variant identity', () => {
    const items = [
      {
        product_id: 'product-2',
        variant_id: 'variant-2',
        line_id: 88,
        price: 200,
        quantity: 1,
      },
      {
        product_id: 'product-1',
        variant_id: null,
        line_id: 87,
        price: 100,
        quantity: 1,
      },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 30, {
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 10,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
        {
          lineId: 2,
          merchandiseDiscount: 20,
          productId: 'product-2',
          vatRelief: 0,
          variantId: 'variant-2',
        },
      ],
    });

    expect(prices).toEqual([180, 90]);
  });

  it('matches duplicate product and variant lines by persisted attributes', () => {
    const items = [
      {
        condition: 'new',
        line_id: 8,
        price: 100,
        product_id: 'product-1',
        quantity: 1,
        variant_attributes: { Color: 'Blue' },
        variant_id: 'variant-1',
      },
      {
        condition: 'used',
        line_id: 9,
        price: 100,
        product_id: 'product-1',
        quantity: 1,
        variant_attributes: { Color: 'Green' },
        variant_id: 'variant-1',
      },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 10, {
      lineDiscounts: [
        {
          lineId: 1,
          lineKey: buildTransactionDiscountLineKey({
            condition: 'new',
            productId: 'product-1',
            variantAttributes: { Color: 'Blue' },
            variantId: 'variant-1',
          }),
          merchandiseDiscount: 10,
          productId: 'product-1',
          vatRelief: 0,
          variantId: 'variant-1',
        },
        null,
      ],
    });

    expect(prices).toEqual([90, 100]);
  });

  it('matches keyed and unkeyed allocations in the same persisted discount', () => {
    const items = [
      {
        condition: 'new',
        line_id: 8,
        price: 100,
        product_id: 'product-1',
        quantity: 1,
        variant_attributes: { Color: 'Blue' },
        variant_id: 'variant-1',
      },
      {
        condition: 'used',
        line_id: 9,
        price: 100,
        product_id: 'product-1',
        quantity: 1,
        variant_attributes: { Color: 'Green' },
        variant_id: 'variant-1',
      },
      {
        line_id: 10,
        price: 200,
        product_id: 'product-2',
        quantity: 1,
        variant_id: null,
      },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 30, {
      lineDiscounts: [
        {
          lineId: 1,
          lineKey: buildTransactionDiscountLineKey({
            condition: 'new',
            productId: 'product-1',
            variantAttributes: { Color: 'Blue' },
            variantId: 'variant-1',
          }),
          merchandiseDiscount: 10,
          productId: 'product-1',
          vatRelief: 0,
          variantId: 'variant-1',
        },
        null,
        {
          lineId: 3,
          merchandiseDiscount: 20,
          productId: 'product-2',
          vatRelief: 0,
          variantId: null,
        },
      ],
    });

    expect(prices).toEqual([90, 100, 180]);
  });

  it('matches one keyed and one unkeyed allocation for duplicate identities', () => {
    const items = [
      {
        condition: 'new',
        line_id: 8,
        price: 100,
        product_id: 'product-1',
        quantity: 1,
        variant_attributes: { Color: 'Blue' },
        variant_id: 'variant-1',
      },
      {
        condition: 'used',
        line_id: 9,
        price: 100,
        product_id: 'product-1',
        quantity: 1,
        variant_attributes: { Color: 'Green' },
        variant_id: 'variant-1',
      },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 30, {
      lineDiscounts: [
        {
          lineId: 1,
          lineKey: buildTransactionDiscountLineKey({
            condition: 'new',
            productId: 'product-1',
            variantAttributes: { Color: 'Blue' },
            variantId: 'variant-1',
          }),
          merchandiseDiscount: 10,
          productId: 'product-1',
          vatRelief: 0,
          variantId: 'variant-1',
        },
        {
          lineId: 2,
          merchandiseDiscount: 20,
          productId: 'product-1',
          vatRelief: 0,
          variantId: 'variant-1',
        },
      ],
    });

    expect(prices).toEqual([90, 80]);
  });

  it('falls back proportionally when persisted allocations are stale', () => {
    const items = [
      { line_id: 1, price: 100, quantity: 1 },
      { line_id: 2, price: 100, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 100, {
      lineDiscounts: [
        { lineId: 1, merchandiseDiscount: 10, vatRelief: 0 },
        { lineId: 2, merchandiseDiscount: 10, vatRelief: 0 },
      ],
    });

    expect(prices).toEqual([50, 50]);
  });

  it('preserves VAT semantics when invalid explicit allocations fall back', () => {
    const items = [
      { line_id: 1, price: 100, quantity: 1 },
      { line_id: 2, price: 100, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 200, {
      lineDiscounts: [
        { lineId: 1, merchandiseDiscount: 100, vatRelief: 100 },
        null,
      ],
    });

    expect(prices[0]).toBeCloseTo(6.976744, 5);
    expect(prices[1]).toBeCloseTo(6.976744, 5);
  });
});
