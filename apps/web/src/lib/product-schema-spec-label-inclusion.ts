import {
  AUDIO_CAPABILITY_LABELS,
  PHONE_ONLY_SPEC_LABELS,
} from './product-schema-spec-label-policy';
import { getKeySpecCategoriesForFamily } from './storefront-specs/spec-category-families';
import type { ProductSpecFamily } from './storefront-specs/spec-family-classifier';
import { isAccessoryLikeCategory } from './storefront-specs/spec-taxonomy';

interface ProductSchemaSpecLabelInclusionInput {
  canonicalSpecKey?: string;
  categoryNames: string[];
  normalizedLabel?: string;
  productFamily: ProductSpecFamily;
}

export function shouldIncludeProductSchemaSpecByLabel(
  input: ProductSchemaSpecLabelInclusionInput
) {
  const { canonicalSpecKey, categoryNames, normalizedLabel, productFamily } =
    input;

  if (!normalizedLabel) {
    if (!canonicalSpecKey) {
      return true;
    }

    if (categoryNames.length === 0) {
      return false;
    }

    if (categoryNames.some(isAccessoryLikeCategory)) {
      return getKeySpecCategoriesForFamily(
        productFamily,
        categoryNames[0]
      ).some((category) =>
        category.fields.some((field) => field.key === canonicalSpecKey)
      );
    }

    return true;
  }

  if (!PHONE_ONLY_SPEC_LABELS.has(normalizedLabel)) {
    return true;
  }

  if (normalizedLabel === 'card slot' || normalizedLabel === 'ois') {
    return true;
  }

  if (normalizedLabel === 'operating system' || normalizedLabel === 'os') {
    return true;
  }

  if (AUDIO_CAPABILITY_LABELS.has(normalizedLabel)) {
    return true;
  }

  return false;
}
