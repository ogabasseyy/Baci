/**
 * Canonical merchant currency resolver.
 *
 * Baci historically had two diverging currency sources: display code keyed off
 * `merchant.country` (falling back to USD) while feeds / JSON-LD keyed off
 * `merchant.payout_currency || 'NGN'`. This module is the single forward-facing
 * API that unifies both.
 *
 * Production reality it is designed around:
 * - `merchants.payout_currency` is NOT NULL (default 'NGN').
 * - `merchants.country` is sometimes NULL (backfilled separately).
 *
 * Resolution order (payout-currency first, NGN platform fallback):
 * - code: normalized `payout_currency` when it looks like an ISO code
 *   (`/^[A-Z]{3}$/`); else the currency of the known `country`; else `'NGN'`.
 * - locale: the locale for the merchant's country when known; else a sensible
 *   default for the resolved currency; else `'en-US'`.
 * - symbol: the matched country entry's symbol when its currency equals the
 *   resolved code; else the currency's preferred symbol; else the code itself.
 */

import { getCountryByCode } from './countries';
import {
  COUNTRY_LOCALES,
  type CurrencyConfig,
  formatCurrencyWithConfig,
} from './currency';
import { CURRENCY_DEFAULT_LOCALES, CURRENCY_SYMBOLS } from './currency-meta';

const ISO_CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * Platform fallback currency. Deliberately NGN (Baci's home market), NOT USD —
 * every merchant row has a NOT NULL `payout_currency` defaulting to 'NGN'.
 */
const DEFAULT_CURRENCY_CODE = 'NGN';
const DEFAULT_LOCALE = 'en-US';

/**
 * Shared platform-fallback currency config. Single source of truth for the
 * NGN default so prompt builders and formatters cannot drift apart.
 */
export const DEFAULT_PLATFORM_CURRENCY_CONFIG: CurrencyConfig = {
  code: DEFAULT_CURRENCY_CODE,
  symbol: CURRENCY_SYMBOLS[DEFAULT_CURRENCY_CODE] ?? DEFAULT_CURRENCY_CODE,
  locale: CURRENCY_DEFAULT_LOCALES[DEFAULT_CURRENCY_CODE] ?? DEFAULT_LOCALE,
};

/**
 * Minimal structural view of a merchant record. Extra fields are accepted and
 * ignored so callers can pass full merchant rows directly.
 */
export interface MerchantCurrencySource {
  country?: string | null;
  payout_currency?: string | null;
}

function normalizeCurrencyCode(payoutCurrency?: string | null): string | null {
  const normalized = payoutCurrency?.trim().toUpperCase();
  if (!normalized || !ISO_CURRENCY_CODE.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Resolve the canonical {@link CurrencyConfig} for a merchant.
 *
 * @param merchant - Merchant record (only `country` and `payout_currency` are read).
 * @returns Currency code, display symbol, and formatting locale.
 *
 * @example
 * resolveMerchantCurrencyConfig({ payout_currency: 'AED', country: 'AE' });
 * // { code: 'AED', symbol: 'د.إ', locale: 'en-AE' }
 */
export function resolveMerchantCurrencyConfig(
  merchant: MerchantCurrencySource
): CurrencyConfig {
  const country = merchant.country
    ? getCountryByCode(merchant.country)
    : undefined;

  const payoutCode = normalizeCurrencyCode(merchant.payout_currency);
  const code = payoutCode ?? country?.currency ?? DEFAULT_CURRENCY_CODE;

  const countryLocale = country ? COUNTRY_LOCALES[country.code] : undefined;
  const locale =
    countryLocale ?? CURRENCY_DEFAULT_LOCALES[code] ?? DEFAULT_LOCALE;

  const symbol =
    country && country.currency === code
      ? country.currencySymbol
      : (CURRENCY_SYMBOLS[code] ?? code);

  return { code, symbol, locale };
}

/**
 * Format an amount in a merchant's resolved currency.
 *
 * Convenience wrapper over {@link resolveMerchantCurrencyConfig} and the cached
 * `formatCurrencyWithConfig` from `@/lib/currency`.
 *
 * @param amount - Numeric amount to format.
 * @param merchant - Merchant record (only `country` and `payout_currency` are read).
 * @param options - Optional `Intl.NumberFormat` overrides (e.g. compact/no-decimal).
 * @returns Localized currency string.
 */
export function formatMerchantCurrency(
  amount: number,
  merchant: MerchantCurrencySource,
  options?: Partial<Intl.NumberFormatOptions>
): string {
  const config = resolveMerchantCurrencyConfig(merchant);
  return formatCurrencyWithConfig(amount, config, options);
}

/**
 * Format an amount when only a bare currency code is available (e.g.
 * `order.currency` on records where the merchant row isn't loaded).
 *
 * @param amount - Numeric amount to format.
 * @param currencyCode - ISO 4217 code; malformed/missing input falls back to NGN.
 * @param options - Optional `Intl.NumberFormat` overrides.
 * @returns Localized currency string.
 */
export function formatAmountInCurrency(
  amount: number,
  currencyCode?: string | null,
  options?: Partial<Intl.NumberFormatOptions>
): string {
  const code = normalizeCurrencyCode(currencyCode) ?? DEFAULT_CURRENCY_CODE;
  const config: CurrencyConfig = {
    code,
    symbol: CURRENCY_SYMBOLS[code] ?? code,
    locale: CURRENCY_DEFAULT_LOCALES[code] ?? DEFAULT_LOCALE,
  };
  return formatCurrencyWithConfig(amount, config, options);
}
