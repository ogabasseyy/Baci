import { buildTransactionDiscountLineOccurrenceKey } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getDiscountedTransactionUnitPrices } from './transaction-review-discount';

describe('getDiscountedTransactionUnitPrices', () => {
  it('allocates an order discount proportionally across merchandise lines', () => {
    const items = [
      { price: 100, quantity: 1 },
      { price: 300, quantity: 3 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 80);

    expect(prices).toEqual([92, 276]);
  });

  it('leaves line prices unchanged when no usable discount or subtotal exists', () => {
    const noDiscountItems = [{ price: 100, quantity: 1 }];
    const invalidPriceItems = [{ price: 'invalid', quantity: 1 }];

    const unchangedPrices = getDiscountedTransactionUnitPrices(
      noDiscountItems,
      0
    );
    const invalidPrices = getDiscountedTransactionUnitPrices(
      invalidPriceItems,
      20
    );

    expect(unchangedPrices).toEqual([100]);
    expect(invalidPrices).toEqual([0]);
  });

  it('uses one unit when a missing quantity follows transaction-review defaults', () => {
    const items = [
      { price: 100, quantity: null },
      { price: 300, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 40);

    expect(prices).toEqual([90, 270]);
  });

  it('does not produce negative revenue when a malformed discount exceeds the subtotal', () => {
    const items = [{ price: 100, quantity: 2 }];

    const prices = getDiscountedTransactionUnitPrices(items, 500);

    expect(prices).toEqual([0]);
  });

  it('preserves negative adjustment lines while discounting merchandise', () => {
    const items = [
      { price: -100, quantity: 1 },
      { price: 100, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 50);

    expect(prices).toEqual([-100, 50]);
  });

  it('applies a full voucher discount to merchandise without discounting assurance', () => {
    const items = [
      { assurance_fee: 10, price: 100, quantity: 1, quiz_award_id: 'award-1' },
      { price: 200, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 100);

    expect(prices).toEqual([0, 200]);
  });

  it('allocates residual discounts to merchandise when voucher metadata is unavailable', () => {
    const items = [
      { price: 100, quantity: 1, quiz_award_id: 'award-1' },
      { price: 200, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 120);

    expect(prices).toEqual([0, 180]);
  });

  it('uses the persisted award amount when calculating voucher residuals', () => {
    const items = [
      {
        price: 120,
        quantity: 1,
        quiz_award_id: 'award-1',
        quiz_award_amount: 100,
      },
      { price: 200, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 80);

    expect(prices).toEqual([40, 200]);
  });

  it('keeps a deleted award line discounted without redistributing it', () => {
    const items = [
      { price: 120, quantity: 1, quiz_award_id: null, quiz_award_amount: 100 },
      { price: 200, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 100);

    expect(prices).toEqual([20, 200]);
  });

  it('keeps non-positive retained amounts eligible for merchandise discounts', () => {
    const items = [
      { price: 100, quantity: 1, quiz_award_id: null, quiz_award_amount: 0 },
      { price: 100, quantity: 1, quiz_award_id: null, quiz_award_amount: -10 },
      { price: 100, quantity: 1, quiz_award_id: null, quiz_award_amount: 50 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 70);

    expect(prices).toEqual([90, 90, 50]);
  });

  it('bounds voucher reductions by the persisted award amount', () => {
    const items = [
      {
        price: 120,
        quantity: 1,
        quiz_award_id: 'award-1',
        quiz_award_amount: 100,
      },
      { price: 200, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 100);

    expect(prices).toEqual([20, 200]);
  });

  it('applies a residual voucher discount after explicit merchandise allocations', () => {
    const items = [
      { line_id: 1, price: 100, quantity: 1, quiz_award_id: 'award-1' },
      { line_id: 2, price: 200, quantity: 1 },
    ];
    const options = {
      lineDiscounts: [
        null,
        { lineId: 2, merchandiseDiscount: 20, vatRelief: 0 },
      ],
    };

    const prices = getDiscountedTransactionUnitPrices(items, 120, options);

    expect(prices).toEqual([0, 180]);
  });

  it('preserves merchandise provenance when a compatibility selector cannot match v3 allocations', () => {
    const items = [
      { price: 100, quantity: 1, quiz_award_id: 'award-1' },
      { price: 200, quantity: 1 },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 120, {
      lineDiscounts: [
        null,
        {
          lineId: 2,
          merchandiseDiscount: 20,
          productId: 'product-2',
          vatRelief: 0,
          variantId: null,
        },
      ],
    });

    expect(prices).toEqual([0, 180]);
  });

  it('matches duplicate line allocations by ascending persisted line id', () => {
    const lineKey = '["product-duplicate",null,null,{}]';
    const items = [
      {
        line_id: 801,
        price: 100,
        product_id: 'product-duplicate',
        quantity: 1,
        variant_id: null,
      },
      {
        line_id: 800,
        price: 100,
        product_id: 'product-duplicate',
        quantity: 1,
        variant_id: null,
      },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 30, {
      lineDiscounts: [
        {
          lineId: 1,
          lineKey: buildTransactionDiscountLineOccurrenceKey(lineKey, 1),
          merchandiseDiscount: 10,
          productId: 'product-duplicate',
          vatRelief: 0,
          variantId: null,
        },
        {
          lineId: 2,
          lineKey: buildTransactionDiscountLineOccurrenceKey(lineKey, 2),
          merchandiseDiscount: 20,
          productId: 'product-duplicate',
          vatRelief: 0,
          variantId: null,
        },
      ],
    });

    expect(prices).toEqual([80, 90]);
  });

  it('allocates discounts across merchandise and assurance fees', () => {
    const items = [{ assurance_fee: 20, price: 100, quantity: 1 }];

    const prices = getDiscountedTransactionUnitPrices(items, 12);

    expect(prices).toEqual([90]);
  });

  it('keeps assurance out of a recognized non-VAT legacy negotiation', () => {
    const items = [{ assurance_fee: 10, price: 100, quantity: 1 }];

    const prices = getDiscountedTransactionUnitPrices(items, 2, {
      discountIncludesVat: false,
    });

    expect(prices).toEqual([98]);
  });

  it('keeps assurance fees out of VAT-inclusive legacy discount allocation', () => {
    const items = [
      {
        assurance_fee: 10,
        price: 100,
        quantity: 1,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ];

    const prices = getDiscountedTransactionUnitPrices(items, 21.5, {
      discountIncludesVat: true,
    });

    expect(prices).toEqual([80]);
  });
});
