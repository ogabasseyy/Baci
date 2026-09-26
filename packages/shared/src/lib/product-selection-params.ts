import { normalizeProductSelectionParamKey } from './normalize-product-selection-param-key';
import { normalizeCanonicalProductCondition } from './product-condition';
import type {
  ProductDefaultVariantLike,
  ProductWithDefaultVariantLike,
} from './product-default-variant';

export type SearchParamValue = string | string[] | null | undefined;

export type SearchParamSource =
  | URLSearchParams
  | Record<string, SearchParamValue>
  | Iterable<[string, SearchParamValue]>;

export interface ProductWithSelectionAxesLike<
  TVariant extends ProductDefaultVariantLike = ProductDefaultVariantLike,
> extends ProductWithDefaultVariantLike<TVariant> {
  attributeAxes?: string[] | null;
  variant_attributes?: Record<string, string[] | null | undefined> | null;
}

export interface ExtractedVariantSelectionParams {
  attributes: Record<string, string>;
  condition?: string;
  hasAttributeParams: boolean;
  hasConditionParam: boolean;
  hasRecognizedSelectionParams: boolean;
  hasVariantIdParam: boolean;
  recognizedParamKeys: string[];
  variantId?: string;
}

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

function normalizeParamValue(value: SearchParamValue) {
  if (Array.isArray(value)) {
    return normalizeParamValue(value[0]);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeConditionValue(value: string | null | undefined) {
  return normalizeCanonicalProductCondition(value) || undefined;
}

function toSearchParamEntries(searchParams: SearchParamSource) {
  if (searchParams instanceof URLSearchParams) {
    const entries: [string, SearchParamValue][] = [];
    searchParams.forEach((value, key) => {
      entries.push([key, value]);
    });
    return entries;
  }

  if (Symbol.iterator in Object(searchParams)) {
    return Array.from(searchParams as Iterable<[string, SearchParamValue]>);
  }

  return Object.entries(searchParams);
}

export function getDeclaredVariantAxes<
  TVariant extends ProductDefaultVariantLike,
>(product: ProductWithSelectionAxesLike<TVariant>) {
  const axes: string[] = [];
  const seen = new Set<string>();

  const registerAxis = (axis: string | null | undefined) => {
    const normalized = normalizeProductSelectionParamKey(axis);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    axes.push(normalized);
  };

  for (const axis of product.attributeAxes || []) {
    registerAxis(axis);
  }

  for (const axis of Object.keys(product.variant_attributes || {})) {
    registerAxis(axis);
  }

  for (const variant of product.variants || []) {
    for (const axis of Object.keys(variant.attributes || {})) {
      registerAxis(axis);
    }
  }

  return axes;
}

function getSelectionAxisMap<TVariant extends ProductDefaultVariantLike>(
  product: ProductWithSelectionAxesLike<TVariant>
) {
  return new Map(
    getDeclaredVariantAxes(product).map((axis) => [
      normalizeProductSelectionParamKey(axis),
      axis,
    ])
  );
}

function normalizeVariantAttributes(
  attributes: Record<string, string> | null | undefined
) {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes || {})) {
    const normalizedKey = normalizeProductSelectionParamKey(key);
    const normalizedValue = normalizeParamValue(value);

    if (!normalizedKey || !normalizedValue) {
      continue;
    }

    normalized[normalizedKey] = normalizedValue;
  }

  return normalized;
}

export function extractVariantSelectionParams<
  TVariant extends ProductDefaultVariantLike,
>(
  product: ProductWithSelectionAxesLike<TVariant>,
  searchParams: SearchParamSource
): ExtractedVariantSelectionParams {
  const axisMap = getSelectionAxisMap(product);
  const attributes: Record<string, string> = {};
  const recognizedParamKeys: string[] = [];
  const recognizedParamSet = new Set<string>();
  let condition: string | undefined;
  let variantId: string | undefined;

  const addRecognizedKey = (key: string) => {
    if (recognizedParamSet.has(key)) {
      return;
    }

    recognizedParamSet.add(key);
    recognizedParamKeys.push(key);
  };

  for (const [key, rawValue] of toSearchParamEntries(searchParams)) {
    const normalizedKey = normalizeProductSelectionParamKey(key);
    const normalizedValue = normalizeParamValue(rawValue);

    if (!normalizedKey || !normalizedValue) {
      continue;
    }

    if (normalizedKey === 'variantid' || normalizedKey === 'variant_id') {
      variantId = normalizedValue;
      addRecognizedKey('variantId');
      continue;
    }

    if (normalizedKey === 'condition') {
      condition = normalizeConditionValue(normalizedValue);
      if (condition) {
        addRecognizedKey('condition');
      }
      continue;
    }

    const axis = axisMap.get(normalizedKey);
    if (!axis) {
      continue;
    }

    attributes[axis] = normalizedValue;
    addRecognizedKey(axis);
  }

  return {
    attributes,
    condition,
    hasAttributeParams: Object.keys(attributes).length > 0,
    hasConditionParam: Boolean(condition),
    hasRecognizedSelectionParams:
      Boolean(variantId) ||
      Boolean(condition) ||
      Object.keys(attributes).length > 0,
    hasVariantIdParam: Boolean(variantId),
    recognizedParamKeys,
    variantId,
  };
}

export function findVariantSelectionMatches<
  TVariant extends ProductDefaultVariantLike,
>(
  product: ProductWithSelectionAxesLike<TVariant>,
  options: {
    attributes?: Record<string, string> | null;
    condition?: string | null;
    variantId?: string | null;
  },
  config?: {
    includeOutOfStock?: boolean;
  }
) {
  const normalizedAttributes = normalizeVariantAttributes(options.attributes);
  const requestedCondition = normalizeConditionValue(options.condition);
  const includeOutOfStock = config?.includeOutOfStock ?? true;

  const variantCandidates = (product.variants || []).filter((variant) => {
    if (includeOutOfStock || product.manage_stock === false) {
      return true;
    }

    if (typeof variant.stock_quantity === 'number') {
      return variant.stock_quantity > 0;
    }

    if (typeof variant.in_stock === 'boolean') {
      return variant.in_stock;
    }

    return true;
  });

  if (options.variantId) {
    return variantCandidates.filter(
      (variant) => variant.id === options.variantId
    );
  }

  if (Object.keys(normalizedAttributes).length > 0) {
    return variantCandidates.filter((variant) => {
      const variantAttributes = normalizeVariantAttributes(variant.attributes);
      const attributeMatch = Object.entries(normalizedAttributes).every(
        ([axis, value]) => variantAttributes[axis] === value
      );

      if (!attributeMatch) {
        return false;
      }

      if (!requestedCondition) {
        return true;
      }

      return (
        normalizeConditionValue(variant.condition ?? product.condition) ===
        requestedCondition
      );
    });
  }

  if (!requestedCondition) {
    return [];
  }

  return variantCandidates.filter(
    (variant) =>
      normalizeConditionValue(variant.condition ?? product.condition) ===
      requestedCondition
  );
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

    return {
      extracted,
      matches,
      selectionInput: extracted.variantId
        ? { variantId: extracted.variantId }
        : {},
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
