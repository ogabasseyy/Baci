// Canonical money formatting for @baci/shared.
//
// Semantic decision (formatting wave, audit row 1): the currency code is
// the source of truth. Locale is derived from the currency via
// MONEY_CURRENCY_LOCALES — not from merchant country, device locale, or
// a per-app default — so web, mobile-storefront, and mobile-admin render
// the same amount identically for the same currency. Fraction digits are
// an explicit per-call-class option (standard 2, whole-amount 0, compact),
// never a hidden per-app default.
//
// This module extracts the formatter that previously lived receipt-scoped
// in ../receipt/receipt-money.ts (same locale map and cache behaviour);
// receipt-money re-exports createMoneyFormatter from here so there is one
// formatter implementation and one cache in the package.
//
// Hermes/Intl caveat: the characterization tests pin Node ICU output for
// the allowlisted currencies in MONEY_CURRENCY_LOCALES. Runtimes without
// full Intl data (older Hermes) may render differently; mobile adoption
// PRs must verify allowlisted currencies on-device before switching call
// sites, per the audit decision-rule check.

export const MONEY_CURRENCY_LOCALES: Record<string, string> = {
  NGN: 'en-NG',
  GHS: 'en-GH',
  KES: 'en-KE',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
  ZAR: 'en-ZA',
  XAF: 'fr-CM',
  XOF: 'fr-SN',
};

/** Currencies whose Node-pinned output mobile adoption may rely on. */
export const SUPPORTED_MONEY_CURRENCIES = Object.freeze(
  Object.keys(MONEY_CURRENCY_LOCALES)
);

const DEFAULT_CURRENCY = 'NGN';
const MAX_FORMATTER_CACHE_SIZE = 100;

export type MoneyFormatter = (amount: number) => string;

export interface FormatMoneyOptions extends Intl.NumberFormatOptions {
  /** Explicit locale override; defaults to the currency-derived locale. */
  locale?: string;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

export function normalizeMoneyCurrency(currencyCode: string): string {
  const normalized = currencyCode.trim().toUpperCase();
  return normalized || DEFAULT_CURRENCY;
}

export function resolveMoneyLocale(currencyCode: string): string {
  return (
    MONEY_CURRENCY_LOCALES[normalizeMoneyCurrency(currencyCode)] ?? 'en-NG'
  );
}

function getMoneyFormatter(
  currencyCode: string,
  options: FormatMoneyOptions
): Intl.NumberFormat {
  const { locale: localeOverride, ...numberFormatOptions } = options;
  const currency = normalizeMoneyCurrency(currencyCode);
  const locale = localeOverride ?? resolveMoneyLocale(currency);
  const finalOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...numberFormatOptions,
  };
  const cacheKey = `${locale}:${JSON.stringify(finalOptions)}`;

  const cached = formatterCache.get(cacheKey);
  if (cached) {
    // Refresh recency so eviction drops the least recently used entry.
    formatterCache.delete(cacheKey);
    formatterCache.set(cacheKey, cached);
    return cached;
  }

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, finalOptions);
  } catch {
    // Runtime without full Intl data for the derived locale: retry with
    // the default locale, and let a structurally invalid currency code
    // surface from this second construction instead of masking it.
    formatter = new Intl.NumberFormat('en-NG', finalOptions);
  }
  if (formatterCache.size >= MAX_FORMATTER_CACHE_SIZE) {
    const oldest = formatterCache.keys().next().value;
    if (oldest !== undefined) formatterCache.delete(oldest);
  }
  formatterCache.set(cacheKey, formatter);
  return formatter;
}

/** Format a major-unit amount (e.g. naira, not kobo) for `currencyCode`. */
export function formatMoney(
  amount: number,
  currencyCode: string = DEFAULT_CURRENCY,
  options: FormatMoneyOptions = {}
): string {
  return getMoneyFormatter(currencyCode, options).format(amount);
}

/**
 * Format a minor-unit amount (kobo/cents). Assumes a 2-decimal currency;
 * every currency in SUPPORTED_MONEY_CURRENCIES is 2-decimal.
 */
export function formatMoneyMinor(
  amountMinor: number,
  currencyCode: string = DEFAULT_CURRENCY,
  options: FormatMoneyOptions = {}
): string {
  return formatMoney(amountMinor / 100, currencyCode, options);
}

/** Compact display (e.g. ₦1.2M). Small amounts keep standard notation. */
export function formatMoneyCompact(
  amount: number,
  currencyCode: string = DEFAULT_CURRENCY,
  options: FormatMoneyOptions = {}
): string {
  const useCompact = Math.abs(amount) >= 1_000;
  return formatMoney(amount, currencyCode, {
    notation: useCompact ? 'compact' : 'standard',
    compactDisplay: 'short',
    minimumFractionDigits: useCompact ? 1 : 2,
    maximumFractionDigits: 2,
    ...options,
  });
}

export function createMoneyFormatter(
  currencyCode: string,
  options: FormatMoneyOptions = {}
): MoneyFormatter {
  const formatter = getMoneyFormatter(currencyCode, options);
  return (amount) => formatter.format(amount);
}
