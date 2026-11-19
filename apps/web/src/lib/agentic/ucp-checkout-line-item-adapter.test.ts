import { describe, expect, it } from 'vitest';
import { mapUcpCheckoutLineItem } from './ucp-checkout-line-item-adapter';

describe('mapUcpCheckoutLineItem', () => {
  it('uses the pre-tax unit price while preserving a VAT-inclusive line total', () => {
    expect(
      mapUcpCheckoutLineItem({
        base_amount: 2_000,
        id: 'line_product_1',
        item: { id: 'product_1', quantity: 2, title: 'Laptop' },
        subtotal: 2_000,
        total: 2_150,
      })
    ).toMatchObject({
      id: 'line_product_1',
      item: { id: 'product_1', price: 1_000, title: 'Laptop' },
      quantity: 2,
      totals: [
        { amount: 2_000, type: 'subtotal' },
        { amount: 2_150, type: 'total' },
      ],
    });
  });

  it('falls back to subtotal and line total while normalizing invalid identity data', () => {
    expect(
      mapUcpCheckoutLineItem({
        id: '',
        item: { id: '', quantity: 0, title: '   ' },
        subtotal: 1_500,
        total: 1_500,
      })
    ).toMatchObject({
      id: 'unknown',
      item: { id: 'unknown', price: 1_500, title: 'Unknown item' },
      quantity: 1,
      totals: [
        { amount: 1_500, type: 'subtotal' },
        { amount: 1_500, type: 'total' },
      ],
    });
  });
});
