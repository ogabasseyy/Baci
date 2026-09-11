import { expect, it } from 'vitest';
import { UNLIMITED_STOCK_QUANTITY } from './feed-constants';
import { getFeedStockCount } from './feed-stock';

const product = {
  id: 'p',
  name: 'Phone',
  price: 10,
  description: '',
  stock: 4,
  manage_stock: true,
};
it('uses option stock for managed SKUs and unlimited stock otherwise', () => {
  expect(getFeedStockCount(product, { stock_quantity: 0 })).toBe(0);
  expect(getFeedStockCount(product, { stock_quantity: 7 })).toBe(7);
  expect(getFeedStockCount(product, { stock_quantity: -1 })).toBe(0);
  expect(getFeedStockCount(product, { stock_quantity: Number.NaN })).toBe(0);
  expect(getFeedStockCount(product)).toBe(4);
  expect(
    getFeedStockCount(
      { ...product, manage_stock: false },
      { stock_quantity: 0 }
    )
  ).toBe(UNLIMITED_STOCK_QUANTITY);
});
