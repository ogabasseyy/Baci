import { formatCurrencyCompact } from '@/lib/currency';
import { formatVerifiedProductSpecHighlights } from '@/lib/format-verified-product-spec-highlights';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';
import { toTitleCase } from '@/lib/to-title-case';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

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
): string[] {
  const bullets: string[] = [];

  if (input.currentProduct.condition) {
    bullets.push(
      `Available in ${toTitleCase(input.currentProduct.condition)} condition`
    );
  }

  const containingBand = getCuratedPriceBands(input.categorySlug, {
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

  if (
    input.currentProduct.stock !== undefined &&
    input.currentProduct.stock !== null
  ) {
    bullets.push(
      input.currentProduct.stock > 0
        ? 'In stock for immediate dispatch'
        : 'Currently out of stock'
    );
  }

  const specHighlights = formatVerifiedProductSpecHighlights({
    specs: input.currentProduct.product_key_specs,
    category: input.categoryName || input.categorySlug,
    keys: ['ram_gb', 'storage_gb', 'battery_mah', 'main_camera_mp'],
    maxHighlights: 3,
  });
  if (specHighlights.length > 0) {
    bullets.push(`Key specs: ${specHighlights.join(', ')}`);
  }

  return bullets;
}
