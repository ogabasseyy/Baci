import {
  MONEY_CURRENCY_EXPONENTS,
  normalizeMoneyCurrency,
} from './currency-locales';
import {
  type FormatMoneyOptions,
  getMoneyFormatter,
  type MoneyFormatter,
} from './money-formatter';

export type { MoneyFormatter } from './money-formatter';

/**
 * Bind a formatter for one currency (receipt-style call sites).
 *
 * Receipt path: fraction-digit defaults come only from the allowlist
 * exponent table (legacy 2-digit default for other codes), never from
 * on-device Intl exponent derivation, so receipts gain no new
 * locale-data dependency on Hermes. The new formatMoney entry points
 * keep Intl-derived exponents for non-allowlisted codes.
 */
export function createMoneyFormatter(
  currencyCode: string,
  options: FormatMoneyOptions = {}
): MoneyFormatter {
  const minOption = options.minimumFractionDigits;
  const maxOption = options.maximumFractionDigits;
  // No-bounds call (the receipt contract): fill both bounds from the
  // table so construction performs no Intl exponent derivation.
  // Single-bound calls pass through to getMoneyFormatter's joint
  // resolution, which derives the missing bound from the currency
  // exponent like formatMoney.
  const tableExponent =
    MONEY_CURRENCY_EXPONENTS[normalizeMoneyCurrency(currencyCode)] ?? 2;
  const formatter =
    minOption === undefined && maxOption === undefined
      ? getMoneyFormatter(currencyCode, {
          ...options,
          minimumFractionDigits: tableExponent,
          maximumFractionDigits: tableExponent,
        })
      : getMoneyFormatter(currencyCode, options);
  return (amount) => formatter.format(amount);
}
