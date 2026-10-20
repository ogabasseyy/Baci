import { type FormatMoneyOptions, getMoneyFormatter } from './money-formatter';

/** Format a major-unit amount (e.g. naira, not kobo) for `currencyCode`. */
export function formatMoney(
  amount: number,
  currencyCode = 'NGN',
  options: FormatMoneyOptions = {}
): string {
  return getMoneyFormatter(currencyCode, options).format(amount);
}
