import { formatMerchantPrice } from '@/lib/format-merchant-currency';

/**
 * Formats an order amount using the currency's own locale conventions
 * (`formatMerchantAmount`) instead of hardcoding `en-NG` for every currency.
 * `formatMerchantAmount` already normalizes unsupported currency codes down
 * to NGN, so no try/catch around an invalid `Intl.NumberFormat` currency is
 * needed here.
 */
export function formatOrderDetailsPrice(
  amount: number,
  merchantCurrency: string
) {
  return formatMerchantPrice(amount, { payout_currency: merchantCurrency });
}

export function parseOrderDetailsCurrencyInput(formattedValue: string) {
  const normalized = formattedValue.replace(/,/g, '');
  const cleaned = normalized.replace(/[^0-9.]/g, '');
  const [whole = '', ...decimals] = cleaned.split('.');

  return decimals.length > 0 ? `${whole}.${decimals.join('')}` : whole;
}

export function formatOrderDetailsDate(dateString: string) {
  if (!dateString) {
    return '-';
  }

  const nextDate = new Date(dateString);
  if (Number.isNaN(nextDate.getTime())) {
    return '-';
  }

  return nextDate.toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
