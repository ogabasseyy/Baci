import { getAvailableOptionsForAxis } from '@/components/storefront/ogabassey/variant-attributes';
import {
  getVariantBackedSelections,
  hasVariantBackedAxis,
} from '@/components/storefront/ogabassey/pages/product-details-page/cart-helpers';
import type { NormalizedProductDetails } from '@/components/storefront/ogabassey/pages/product-details-page/product-normalization';

type VariantList = NormalizedProductDetails['variants'];

function getAvailabilityConstraintsForAxis(
  selections: Record<string, string>,
  targetAxis: string,
  variants: VariantList
): Record<string, string> {
  return getVariantBackedSelections(
    Object.fromEntries(
      Object.entries(selections).filter(([key]) => key !== targetAxis)
    ),
    variants
  );
}

export function pruneSelectionsByVariantAvailability(
  next: Record<string, string>,
  changedAxis: string,
  variants: VariantList | undefined
): Record<string, string> {
  if (!variants?.length) {
    return next;
  }

  return Object.fromEntries(
    Object.entries(next).filter(([key, selectedValue]) => {
      if (key === changedAxis) {
        return true;
      }

      if (!hasVariantBackedAxis(key, variants)) {
        return true;
      }

      const constraints = getAvailabilityConstraintsForAxis(
        next,
        key,
        variants
      );
      return getAvailableOptionsForAxis(key, variants, constraints).includes(
        selectedValue
      );
    })
  );
}
