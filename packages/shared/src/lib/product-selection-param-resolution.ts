import { normalizeCanonicalProductCondition } from './product-condition';
import type { ProductDefaultVariantLike } from './product-default-variant';
import type {
  ExtractedVariantSelectionParams,
  ProductWithSelectionAxesLike,
  SearchParamSource,
} from './product-selection-params';
import {
  extractVariantSelectionParams,
  findVariantSelectionMatches,
} from './product-selection-params';

export type VariantSelectionParamResolutionType =
  | 'none'
  | 'variant_id'
  | 'condition_only'
  | 'condition_with_attributes'
  | 'attribute_only'
  | 'invalid_variant_id'
  | 'zero_match'
  | 'ambiguous';

export interface VariantSelectionParamResolution<
  TVariant extends ProductDefaultVariantLike = ProductDefaultVariantLike,
> {
  extracted: ExtractedVariantSelectionParams;
  matches: TVariant[];
  selectionInput: {
    attributes?: Record<string, string>;
    condition?: string;
    variantId?: string;
  };
  type: VariantSelectionParamResolutionType;
}

export function resolveVariantSelectionParamResolution<
  TVariant extends ProductDefaultVariantLike,
>(
  product: ProductWithSelectionAxesLike<TVariant>,
  searchParams: SearchParamSource
): VariantSelectionParamResolution<TVariant> {
  const extracted = extractVariantSelectionParams(product, searchParams);

  if (!extracted.hasRecognizedSelectionParams) {
    return {
      extracted,
      matches: [],
      selectionInput: {},
      type: 'none',
    };
  }

  if (extracted.hasVariantIdParam) {
    const matches = findVariantSelectionMatches(
      product,
      { variantId: extracted.variantId },
      { includeOutOfStock: true }
    );

    // Paired offer links carry both params and the variant they name has no
    // condition of its own, so the explicit condition survives. When the
    // matched variant carries a conflicting condition, the variant wins and
    // the param drops: downstream seeds fall back to the variant, keeping
    // price, label, and cart consistent instead of mixing axes.
    const [match] = matches;
    const variantCondition =
      matches.length === 1
        ? normalizeCanonicalProductCondition(match?.condition)
        : '';
    const retainCondition =
      extracted.condition &&
      (!variantCondition || variantCondition === extracted.condition);
    return {
      extracted,
      matches,
      selectionInput: {
        ...(retainCondition ? { condition: extracted.condition } : {}),
        ...(extracted.variantId ? { variantId: extracted.variantId } : {}),
      },
      type: matches.length === 1 ? 'variant_id' : 'invalid_variant_id',
    };
  }

  if (extracted.hasConditionParam && extracted.hasAttributeParams) {
    const matches = findVariantSelectionMatches(
      product,
      {
        attributes: extracted.attributes,
        condition: extracted.condition,
      },
      { includeOutOfStock: true }
    );

    return {
      extracted,
      matches,
      selectionInput:
        matches.length === 1
          ? {
              attributes: extracted.attributes,
              condition: extracted.condition,
            }
          : {},
      type:
        matches.length === 1
          ? 'condition_with_attributes'
          : matches.length === 0
            ? 'zero_match'
            : 'ambiguous',
    };
  }

  if (extracted.hasConditionParam) {
    const matches = findVariantSelectionMatches(
      product,
      { condition: extracted.condition },
      { includeOutOfStock: true }
    );

    return {
      extracted,
      matches,
      selectionInput:
        matches.length > 0 && extracted.condition
          ? { condition: extracted.condition }
          : {},
      type: matches.length > 0 ? 'condition_only' : 'zero_match',
    };
  }

  return {
    extracted,
    matches: [],
    selectionInput: {
      attributes: extracted.attributes,
    },
    type: 'attribute_only',
  };
}
