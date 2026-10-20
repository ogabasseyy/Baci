import {
  type FormatMoneyOptions,
  getMoneyFormatter,
  type MoneyFormatter,
} from './money-formatter';

export type { MoneyFormatter } from './money-formatter';

/** Bind a formatter for one currency (receipt-style call sites). */
export function createMoneyFormatter(
  currencyCode: string,
  options: FormatMoneyOptions = {}
): MoneyFormatter {
  const formatter = getMoneyFormatter(currencyCode, options);
  return (amount) => formatter.format(amount);
}
