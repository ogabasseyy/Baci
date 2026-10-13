import type { MerchantData } from '@/hooks/merchant/types';
import { getCountryByCode } from '@/lib/countries';

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function getCurrencyFormatter(
  locale: string,
  currency: string,
  useCompact: boolean
): Intl.NumberFormat {
  const key = `${locale}:${currency}:${useCompact}`;
  let formatter = currencyFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      notation: useCompact ? 'compact' : 'standard',
      maximumFractionDigits: useCompact ? 1 : 2,
    });
    currencyFormatterCache.set(key, formatter);
  }
  return formatter;
}

export function createAnalyticsFormatters(merchant: MerchantData | null) {
  const country = merchant?.country
    ? getCountryByCode(merchant.country)
    : undefined;
  const locale = country ? `en-${country.code}` : 'en-US';
  const currency = country ? country.currency : 'USD';

  return {
    formatCurrency(value: number): string {
      return getCurrencyFormatter(locale, currency, value >= 100000).format(
        value
      );
    },
    formatPercent(value: number): string {
      return percentFormatter.format(value / 100);
    },
  };
}

export function formatTopProductUnits(units: number | undefined): string {
  return `${units ?? 0} units sold`;
}
