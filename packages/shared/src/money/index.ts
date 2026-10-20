// Canonical money formatting for @baci/shared (formatting wave).
// Currency code is the source of truth; see currency-locales.ts for
// the semantic decision and the Hermes/Intl caveat.
export { createMoneyFormatter } from './create-money-formatter';
export {
  getMoneyCurrencyExponent,
  getMoneyDisplayExponent,
  MONEY_CURRENCY_EXPONENTS,
  MONEY_CURRENCY_LOCALES,
  normalizeMoneyCurrency,
  resolveMoneyLocale,
  SUPPORTED_MONEY_CURRENCIES,
} from './currency-locales';
export { formatMoney } from './format-money';
export {
  type FormatMoneyCompactOptions,
  formatMoneyCompact,
} from './format-money-compact';
export { formatMoneyMinor } from './format-money-minor';
export type {
  FormatMoneyOptions,
  MoneyFormatter,
} from './money-formatter';
