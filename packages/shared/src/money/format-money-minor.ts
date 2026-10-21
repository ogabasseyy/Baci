import { getMoneyCurrencyExponent } from './currency-locales';
import { formatMoney } from './format-money';
import type { FormatMoneyOptions } from './money-formatter';

/**
 * Format a minor-unit amount (kobo/cents), scaling by the currency's
 * ISO 4217 exponent: 100 minor units per major unit for 2-decimal
 * currencies, and no scaling for zero-decimal currencies (XAF/XOF),
 * whose amounts are already major units.
 */
export function formatMoneyMinor(
  amountMinor: number,
  currencyCode = 'NGN',
  options: FormatMoneyOptions = {}
): string {
  const scale = 10 ** getMoneyCurrencyExponent(currencyCode);
  return formatMoney(amountMinor / scale, currencyCode, options);
}
