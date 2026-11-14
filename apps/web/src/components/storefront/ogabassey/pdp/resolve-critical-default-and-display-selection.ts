import {
  resolveDefaultVariantSelection,
  resolveLowestPricedVariantSelection,
  resolveVariantDisplaySelection,
} from '@baci/shared/lib/product-default-variant';
import { filterDefaultAdvertisedVariants } from '@/lib/default-advertised-variants';
import type { Product as CartProduct } from '@/lib/products';
import type { InitialCriticalVariantSelection } from './critical-commerce-selection';

export function resolveCriticalDefaultAndDisplaySelection({
  explicitVariantCondition,
  initialResolverAttributes,
  initialVariantSelection,
  selectionCartProduct,
  variants,
}: {
  explicitVariantCondition?: string;
  initialResolverAttributes: Record<string, string>;
  initialVariantSelection?: InitialCriticalVariantSelection;
  selectionCartProduct: CartProduct;
  variants: NonNullable<CartProduct['variants']>;
}) {
  const defaultSelectionProduct = {
    ...selectionCartProduct,
    variants: filterDefaultAdvertisedVariants(variants, selectionCartProduct),
  };
  const conditionDefaultVariantSelection =
    selectionCartProduct.has_variants && explicitVariantCondition
      ? resolveDefaultVariantSelection(defaultSelectionProduct, {
          condition: explicitVariantCondition,
        })
      : null;
  const priceDefaultVariantSelection = selectionCartProduct.has_variants
    ? resolveLowestPricedVariantSelection(defaultSelectionProduct)
    : null;
  const defaultVariantSelection = selectionCartProduct.has_variants
    ? (conditionDefaultVariantSelection ??
      priceDefaultVariantSelection ??
      resolveDefaultVariantSelection(defaultSelectionProduct, {
        condition: explicitVariantCondition,
      }))
    : null;
  const initialDisplayVariantSelection = selectionCartProduct.has_variants
    ? (resolveVariantDisplaySelection(selectionCartProduct, {
        attributes: initialResolverAttributes,
        condition: explicitVariantCondition,
        variantId: initialVariantSelection?.variantId,
      }) ?? defaultVariantSelection)
    : null;

  return {
    defaultVariantSelection,
    initialDisplayVariantSelection,
  };
}
