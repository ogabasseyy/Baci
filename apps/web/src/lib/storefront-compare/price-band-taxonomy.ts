import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import type { PriceBandDefinition } from './compare-types';
import { getConfiguredPriceBands } from './get-configured-price-bands';
import { isPriceBandCurrencySupported } from './is-price-band-currency-supported';

/**
 * Standard product pool limit when evaluating commercial support (price bands,
 * brand comparison) for categories in both sitemap generation and page loaders.
 */
export const COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT = 150;

export function getCuratedPriceBands(
  categorySlug: string,
  options?: { merchantCurrency?: string | null }
): PriceBandDefinition[] {
  if (
    !Object.hasOwn(CATEGORY_HUB_DEFAULTS, categorySlug) ||
    !isPriceBandCurrencySupported(categorySlug, options?.merchantCurrency)
  ) {
    return [];
  }
  return getConfiguredPriceBands(categorySlug);
}
