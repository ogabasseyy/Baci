import {
  type ProductDefaultVariantLike,
  type ProductWithDefaultVariantLike,
  resolveDefaultVariantSelection,
  resolveLowestPricedVariantSelection,
} from '@baci/shared/lib/product-default-variant';
import type { StorefrontVariantProductContext } from './cellular-phone-classification';
import { filterDefaultAdvertisedVariants } from './default-advertised-variants';

/** Preserve the PDP price-first default while excluding restricted phone units. */
export function resolveDefaultAdvertisedVariantSelection<
  TVariant extends ProductDefaultVariantLike,
>(
  product: ProductWithDefaultVariantLike<TVariant>,
  context: StorefrontVariantProductContext
) {
  const defaultProduct = {
    ...product,
    variants: filterDefaultAdvertisedVariants(product.variants ?? [], context),
  };
  return (
    resolveLowestPricedVariantSelection(defaultProduct) ??
    resolveDefaultVariantSelection(defaultProduct)
  );
}
