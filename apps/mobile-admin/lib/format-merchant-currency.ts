import { COUNTRIES } from '@/constants/countries';
import { MERCHANT_CURRENCY_LOCALES } from './currency-meta';
import { formatCurrency, normalizeMerchantCurrency } from './utils';

/**
 * Minimal merchant shape needed to resolve a display currency. Accepts the
 * full `Merchant` type from `useMerchant`, an order row (which carries the
 * merchant's payout currency at order time), or an ad-hoc object — any
 * caller that only has a currency/country pair on hand.
 */
export interface MerchantCurrencyProfile {
  payout_currency?: string | null;
  country?: string | null;
}

const DEFAULT_MERCHANT_CURRENCY = 'NGN';

function resolveCountryCurrency(country?: string | null): string | undefined {
  const normalizedCountry = country?.trim().toUpperCase();
  if (!normalizedCountry) return undefined;

  const match = COUNTRIES.find((entry) => entry.code === normalizedCountry);
  return match ? normalizeMerchantCurrency(match.currency) : undefined;
}

/**
 * Resolves the ISO-4217 currency code for a merchant using the same
 * payout_currency-first fallback chain the web backend uses:
 * payout_currency -> country-derived currency -> NGN.
 */
function resolveMerchantCurrency(
  merchant?: MerchantCurrencyProfile | null
): string {
  return (
    normalizeMerchantCurrency(merchant?.payout_currency) ??
    resolveCountryCurrency(merchant?.country) ??
    DEFAULT_MERCHANT_CURRENCY
  );
}

/**
 * Formats `amount` using the merchant's resolved currency and a locale that
 * matches that currency's home-market formatting conventions. Intended for
 * non-hook contexts (generated PDF/HTML reports, plain utilities); React
 * components should prefer the `useCurrency` hook, which shares the same
 * underlying `formatCurrency` implementation.
 */
export function formatMerchantAmount(
  amount: number,
  merchant?: MerchantCurrencyProfile | null,
  options?: Partial<Intl.NumberFormatOptions>
): string {
  const currency = resolveMerchantCurrency(merchant);
  const locale = MERCHANT_CURRENCY_LOCALES[currency];
  return formatCurrency(amount, options, currency, locale);
}

/**
 * Formats a price for display: whole amounts drop the decimals (₦44,850)
 * and anything with a fractional part always shows two (₦48,500.40), so a
 * price never renders with a single trailing decimal digit.
 */
export function formatMerchantPrice(
  amount: number,
  merchant?: MerchantCurrencyProfile | null
): string {
  const hasFraction = Math.round(amount * 100) % 100 !== 0;
  return formatMerchantAmount(amount, merchant, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
