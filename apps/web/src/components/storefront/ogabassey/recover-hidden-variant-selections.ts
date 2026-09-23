import {
  canonicalizeCommerceVariantAxis,
  normalizeCanonicalProductCondition,
  normalizeCommerceVariantOption,
} from '@baci/shared/lib';
import type { NormalizedProductDetails } from '@/components/storefront/ogabassey/pages/product-details-page/product-normalization';

type VariantList = NormalizedProductDetails['variants'];

function normalizeVariantAttributeRecord(
  attributes: Record<string, unknown> | null | undefined
) {
  const normalized: Record<string, string> = {};

  for (const [rawAxis, value] of Object.entries(attributes ?? {})) {
    const axis = canonicalizeCommerceVariantAxis(rawAxis);
    const normalizedValue = axis
      ? normalizeCommerceVariantOption(axis, value)
      : '';

    if (axis && normalizedValue) {
      normalized[axis] = normalizedValue;
    }
  }

  return normalized;
}

function normalizeSelectionEntries(selections: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(selections).flatMap(([rawAxis, rawValue]) => {
      const axis = canonicalizeCommerceVariantAxis(rawAxis);
      if (!axis || !rawValue.trim()) {
        return [];
      }

      if (axis === 'condition') {
        const condition = normalizeCanonicalProductCondition(rawValue);
        return condition ? [[axis, condition] as const] : [];
      }

      const value = normalizeCommerceVariantOption(axis, rawValue);
      return value ? [[axis, value] as const] : [];
    })
  );
}

/**
 * After availability pruning removes a hidden required axis, recover its value
 * from the uniquely matching SKU so shoppers are not stuck without a control.
 */
export function recoverHiddenSelectionsFromUniqueVariant(
  selections: Record<string, string>,
  hiddenAxes: readonly string[],
  variants: VariantList | undefined
): Record<string, string> {
  if (!variants?.length || hiddenAxes.length === 0) {
    return selections;
  }

  const missingHiddenAxes = hiddenAxes.filter(
    (axis) => !selections[axis]?.trim()
  );
  if (missingHiddenAxes.length === 0) {
    return selections;
  }

  const normalizedSelections = normalizeSelectionEntries(selections);
  const matchingVariants = variants.filter((variant) => {
    const attributes = normalizeVariantAttributeRecord(variant.attributes);
    return Object.entries(normalizedSelections).every(([axis, value]) => {
      if (axis === 'condition') {
        return normalizeCanonicalProductCondition(variant.condition) === value;
      }

      return attributes[axis] === value;
    });
  });

  if (matchingVariants.length !== 1) {
    return selections;
  }

  const uniqueAttributes = normalizeVariantAttributeRecord(
    matchingVariants[0]?.attributes
  );
  const recovered = { ...selections };

  for (const rawAxis of missingHiddenAxes) {
    const axis = canonicalizeCommerceVariantAxis(rawAxis);
    if (!axis) {
      continue;
    }

    if (axis === 'condition') {
      const condition = normalizeCanonicalProductCondition(
        matchingVariants[0]?.condition
      );
      if (condition) {
        recovered[axis] = condition;
      }
      continue;
    }

    const value = uniqueAttributes[axis];
    if (value) {
      recovered[axis] = value;
    }
  }

  return recovered;
}
