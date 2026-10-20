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
  // Every call on this receipt path resolves its fraction bounds from
  // the table (legacy 2-digit fallback for non-allowlisted codes): a
  // lone caller bound is paired against the table exponent here, so
  // construction never performs Intl exponent derivation. This differs
  // from formatMoney, whose lone bounds resolve against the derived
  // ISO exponent.
  const tableExponent =
    MONEY_CURRENCY_EXPONENTS[normalizeMoneyCurrency(currencyCode)] ?? 2;
  const formatter = getMoneyFormatter(currencyCode, {
    ...options,
    minimumFractionDigits:
      minOption ??
      (maxOption !== undefined
        ? Math.min(tableExponent, maxOption)
        : tableExponent),
    maximumFractionDigits:
      maxOption ??
      (minOption !== undefined
        ? Math.max(tableExponent, minOption)
        : tableExponent),
  });
  return (amount) => formatter.format(amount);
}
