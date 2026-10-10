import { expect, it } from 'vitest';
import { isVariantRowPurchasable } from './cart-handoff-variant-availability';

it('inherits parent stock for a nullable ordinary row', () => {
  expect(
    isVariantRowPurchasable({ stock_quantity: null }, 5, 1)
  ).toBe(true);
  expect(
    isVariantRowPurchasable({ stock_quantity: null }, 0, 1)
  ).toBe(false);
  expect(
    isVariantRowPurchasable(
      { stock_quantity: null, effective_policy: null },
      5,
      6
    )
  ).toBe(false);
});

it('gates a nullable strict row on exact units, never the parent', () => {
  expect(
    isVariantRowPurchasable(
      { stock_quantity: null, effective_policy: 'serialized_strict' },
      5,
      1
    )
  ).toBe(false);
});

it('keeps then-unlimited purchasable and ordinary rows exact', () => {
  expect(
    isVariantRowPurchasable(
      { stock_quantity: 0, effective_policy: 'serialized_then_unlimited' },
      0,
      10
    )
  ).toBe(true);
  expect(isVariantRowPurchasable({ stock_quantity: 5 }, 0, 5)).toBe(true);
  expect(isVariantRowPurchasable({ stock_quantity: 4 }, 99, 5)).toBe(false);
});
