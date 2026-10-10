import { expect, it } from 'vitest';
import { hasSelectableStockedOffer } from './cart-handoff-offer-availability';

it('accepts a stocked first row of a non-parent condition', () => {
  expect(
    hasSelectableStockedOffer(
      [
        { condition: 'new', stock_quantity: 0 },
        { condition: 'Used', stock_quantity: 5 },
      ],
      'new',
      1
    )
  ).toBe(true);
});

it('drops same-condition rows the PDP cannot resolve', () => {
  expect(
    hasSelectableStockedOffer(
      [{ condition: 'New', stock_quantity: 5 }],
      'new',
      1
    )
  ).toBe(false);
});

it('drops stocked later duplicates past the first row per condition', () => {
  expect(
    hasSelectableStockedOffer(
      [
        { condition: 'used', stock_quantity: 0 },
        { condition: 'UK Used', stock_quantity: 5 },
      ],
      'new',
      1
    )
  ).toBe(false);
});

it('keeps offers selectable when the parent condition is missing', () => {
  expect(
    hasSelectableStockedOffer(
      [{ condition: 'new', stock_quantity: 5 }],
      null,
      1
    )
  ).toBe(true);
  expect(hasSelectableStockedOffer(null, 'new', 1)).toBe(false);
  expect(
    hasSelectableStockedOffer(
      [{ condition: null, stock_quantity: 5 }],
      'new',
      1
    )
  ).toBe(false);
});
