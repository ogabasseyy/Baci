import { expect, it } from 'vitest';
import { getSearchCurrencyFormatter } from './search-currency';

it.each([
  ['NGN', '₦'],
  ['USD', '$'],
  ['GBP', '£'],
])('uses %s in search amounts', (currency, symbol) => {
  expect(getSearchCurrencyFormatter(currency).format(100)).toContain(symbol);
});
