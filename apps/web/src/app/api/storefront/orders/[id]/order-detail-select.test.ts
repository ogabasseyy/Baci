import { expect, it } from 'vitest';
import { orderDetailSelect } from './order-detail-select';

it('selects the persisted amounts needed to reconcile a resumed order', () => {
  const order: Record<string, unknown> = {
    subtotal: 10000,
    shipping_fee: 1000,
    tax_amount: 750,
    discount_amount: 500,
    total: 11250,
  };
  const selected = Object.fromEntries(
    orderDetailSelect
      .split(',')
      .map((field) => field.trim())
      .map((field) => [field, order[field]])
  );
  const displayedTotal =
    Number(selected.subtotal) +
    Number(selected.shipping_fee) +
    Number(selected.tax_amount) -
    Number(selected.discount_amount);
  expect(displayedTotal).toBe(selected.total);
});
