import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';

export interface ResolvePriceRangeTitleParams {
  categorySlug: string;
  currencyCode?: string | null;
  rawPrice: number;
  minPrice: number;
  maxPrice: number;
  productCategory: string;
  formatCurrency: (amount: number) => string;
}

/**
 * Resolves the heading title for the storefront price-range products rail.
 * Uses the curated price-band label when the product falls inside a defined
 * band supported by the merchant currency; falls back to formatted price range.
 */
export function resolvePriceRangeTitle(
  params: ResolvePriceRangeTitleParams
): string {
  const curatedPriceBand =
    getCuratedPriceBands(params.categorySlug, {
      merchantCurrency: params.currencyCode,
    }).find(
      (band) =>
        params.rawPrice <= band.ceiling &&
        (band.floor === undefined || params.rawPrice > band.floor) &&
        params.maxPrice <= band.ceiling &&
        (band.floor === undefined || params.minPrice > band.floor)
    ) ?? null;

  if (curatedPriceBand?.label) {
    return curatedPriceBand.label;
  }

  const formattedMax = params.formatCurrency(params.maxPrice);
  const formattedMin = params.formatCurrency(params.minPrice);

  if (params.minPrice < 10000) {
    return `${params.productCategory} Under ${formattedMax}`;
  }

  return `${params.productCategory} ${formattedMin} - ${formattedMax}`;
}
