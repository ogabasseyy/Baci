import type { PriceBandDefinition } from './compare-types';
import { getConfiguredPriceBands } from './get-configured-price-bands';
import { isPriceBandCurrencySupported } from './is-price-band-currency-supported';

export function getCuratedPriceBands(
  categorySlug: string,
  options?: { merchantCurrency?: string | null }
): PriceBandDefinition[] {
  if (!isPriceBandCurrencySupported(categorySlug, options?.merchantCurrency)) {
    return [];
  }
  return getConfiguredPriceBands(categorySlug);
}
