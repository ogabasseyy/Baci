import { formatCurrencyCompact } from '@/lib/currency';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function buildPriceBandLabel(
  input: BuildProductSemanticModelInput,
  ceiling: number
) {
  return `Best ${input.categoryName} Under ${formatCurrencyCompact(
    ceiling,
    input.countryCode || 'NG'
  )}`;
}

export function buildProductTrustBullets(
  input: BuildProductSemanticModelInput
) {
  const bullets: string[] = [];

  if (input.currentProduct.condition) {
    bullets.push(
      `Available in ${toTitleCase(input.currentProduct.condition)} condition`
    );
  }

  const isNonNgnCurrency =
    input.merchantCurrency != null &&
    input.merchantCurrency.trim().toUpperCase() !== 'NGN';

  const containingBand = isNonNgnCurrency
    ? null
    : getCuratedPriceBands(input.categorySlug, {
        merchantCurrency: input.merchantCurrency,
      }).find(
        (band) =>
          input.currentProduct.price <= band.ceiling &&
          (band.floor ? input.currentProduct.price > band.floor : true)
      );

  if (containingBand) {
    bullets.push(
      `Listed in ${buildPriceBandLabel(input, containingBand.ceiling)}`
    );
  }

  return bullets;
}
