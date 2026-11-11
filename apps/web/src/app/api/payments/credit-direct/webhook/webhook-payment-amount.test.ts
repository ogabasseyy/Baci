import { expect, it } from 'vitest';
import {
  getWebhookWalletProductsTotal,
  matchesRecordedFinancedAmount,
} from './webhook-payment-amount';

function products(...amounts: (number | string)[]) {
  return amounts.map((productAmount) => ({
    productAmount,
    productName: 'Item',
    productId: 'item',
  }));
}

it('sums exact kobo for numeric and decimal string inputs', () => {
  expect(
    getWebhookWalletProductsTotal(products(19.99, '0.010', 3000.01, 2000.02))
  ).toBe(5020.03);
  expect(
    matchesRecordedFinancedAmount(products(3000.01, 2000.02), 5000.030000000001)
  ).toBe(true);
  expect(matchesRecordedFinancedAmount(products(19.98), 19.99)).toBe(false);
});

it.each([
  -1,
  0.001,
  '0.001',
  '0x10',
  '1e2',
  '',
  'invalid',
  Number.POSITIVE_INFINITY,
  90071992547410,
])('rejects an invalid provider amount %s', (amount) =>
  expect(getWebhookWalletProductsTotal(products(amount))).toBeNull());

it('rejects an unsafe accumulated kobo total', () => {
  expect(
    getWebhookWalletProductsTotal(products(50000000000000, 50000000000000))
  ).toBeNull();
});
