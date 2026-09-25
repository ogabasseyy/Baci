import { getCountryByCode } from '@/lib/countries';
import { formatDisplayCurrency } from '@/lib/format-display-currency';

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(
  locale: string,
  currency: string
): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let formatter = currencyFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    });
    currencyFormatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Format an order amount in the order's own currency, falling back to the
 * merchant's currency when the order carries no (or no plausible) currency.
 * A missing value must reach the fallback: normalizing it to a synthetic
 * default upstream would mislabel legacy rows under non-NGN merchants.
 */
export function formatOrderCurrency(
  amount: number,
  orderCurrency: string | null | undefined,
  merchantCountry: string | null | undefined
): string {
  const trimmedCurrency = orderCurrency?.trim();
  if (trimmedCurrency && /^[A-Za-z]{3}$/.test(trimmedCurrency)) {
    return formatDisplayCurrency(amount, trimmedCurrency.toUpperCase());
  }
  const country = merchantCountry
    ? getCountryByCode(merchantCountry)
    : undefined;
  const locale = country ? `en-${country.code}` : 'en-US';
  const fallbackCurrency = country ? country.currency : 'USD';
  return getCurrencyFormatter(locale, fallbackCurrency).format(amount);
}
