import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';

interface TrackingCurrencySource {
  country?: string | null;
  payout_currency?: string | null;
}

/**
 * ISO currency code for funnel events, resolved exactly like the storefront
 * price display (`useCurrency`): payout currency, then country, then NGN.
 */
export function resolveTrackingCurrency(
  merchant: TrackingCurrencySource | null | undefined
): string {
  return resolveMerchantCurrencyConfig({
    country: merchant?.country ?? null,
    payout_currency: merchant?.payout_currency ?? null,
  }).code;
}
