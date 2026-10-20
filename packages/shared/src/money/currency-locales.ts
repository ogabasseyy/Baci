// Currency metadata for @baci/shared money formatting.
//
// Semantic decision (formatting wave, audit row 1): the currency code
// is the source of truth. Locale and minor-unit exponent derive from
// the currency via the maps below — not from merchant country, device
// locale, or a per-app default — so web, mobile-storefront, and
// mobile-admin render the same amount identically for the same
// currency.
//
// Hermes/Intl caveat: the characterization tests pin Node ICU output
// for the allowlisted currencies in MONEY_CURRENCY_LOCALES. Runtimes
// without full Intl data (older Hermes) may render differently; mobile
// adoption PRs must verify allowlisted currencies on-device before
// switching call sites, per the audit decision-rule check.

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

/** ISO 4217 minor-unit exponents; XAF/XOF have no minor unit. */
export const MONEY_CURRENCY_EXPONENTS: Record<string, number> = {
  NGN: 2,
  GHS: 2,
  KES: 2,
  USD: 2,
  GBP: 2,
  EUR: 2,
  ZAR: 2,
  XAF: 0,
  XOF: 0,
};

/** Currencies whose Node-pinned output mobile adoption may rely on. */
export const SUPPORTED_MONEY_CURRENCIES = Object.freeze(
  Object.keys(MONEY_CURRENCY_LOCALES)
);

export function normalizeMoneyCurrency(currencyCode: string): string {
  const normalized = currencyCode.trim().toUpperCase();
  if (!normalized) {
    throw new RangeError('Invalid currency code: empty');
  }
  return normalized;
}

export function resolveMoneyLocale(currencyCode: string): string {
  return (
    MONEY_CURRENCY_LOCALES[normalizeMoneyCurrency(currencyCode)] ?? 'en-NG'
  );
}

export function getMoneyCurrencyExponent(currencyCode: string): number {
  return MONEY_CURRENCY_EXPONENTS[normalizeMoneyCurrency(currencyCode)] ?? 2;
}
