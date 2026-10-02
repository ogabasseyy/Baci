import { isProductVariantPurchasable } from './is-product-variant-purchasable';
import {
  getCanonicalProductConditionPreferenceRank,
  normalizeCanonicalProductCondition,
  sortCanonicalProductConditionsByPreference,
} from './product-condition';

export interface ProductDefaultVariantLike {
  id: string;
  attributes?: Record<string, string> | null;
  compare_at_price?: number | null;
  condition?: string | null;
  in_stock?: boolean | null;
  /** Canonical eligibility projected by the public option adapter. */
  is_purchasable?: boolean;
  price?: number | null;
  price_modifier?: number | null;
  price_override?: number | null;
  stock_quantity?: number | null;
}

export interface ProductWithDefaultVariantLike<
  TVariant extends ProductDefaultVariantLike = ProductDefaultVariantLike,
> {
  compare_at_price?: number | null;
  condition?: string | null;
  manage_stock?: boolean | null;
  price: number;
  variants?: TVariant[] | null;
}

export interface ResolvedProductVariantSelection<
  TVariant extends ProductDefaultVariantLike = ProductDefaultVariantLike,
> {
  attributes: Record<string, string>;
  color?: string;
  compareAtPrice?: number;
  condition?: string;
  price: number;
  storage?: string;
  variant: TVariant;
}

interface VariantCandidate<TVariant extends ProductDefaultVariantLike> {
  index: number;
  variant: TVariant;
}

function normalizeConditionValue(value: string | null | undefined) {
  return normalizeCanonicalProductCondition(value);
}

function normalizeAttributeValue(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSelectedAttributes(
  attributes: Record<string, string | null | undefined> | null | undefined
) {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes || {})) {
    const normalizedValue = normalizeAttributeValue(value);
    if (!normalizedValue) {
      continue;
    }

    normalized[key] = normalizedValue;
  }

  return normalized;
}

function getVariantPrice(
  basePrice: number,
  variant: ProductDefaultVariantLike
): number {
  if (typeof variant.price_override === 'number') {
    return variant.price_override;
  }

  if (typeof variant.price === 'number') {
    return variant.price;
  }

  if (typeof variant.price_modifier === 'number') {
    return Math.max(0, basePrice + variant.price_modifier);
  }

  return basePrice;
}

function getVariantCondition<TVariant extends ProductDefaultVariantLike>(
  product: ProductWithDefaultVariantLike<TVariant>,
  variant: TVariant
) {
  return normalizeConditionValue(variant.condition ?? product.condition);
}

function getConditionPreferenceRank(condition: string) {
  return getCanonicalProductConditionPreferenceRank(condition);
}

export function hasVariantConditionAxis<
  TVariant extends ProductDefaultVariantLike,
>(product: ProductWithDefaultVariantLike<TVariant>) {
  return (product.variants || []).some(
    (variant) => normalizeConditionValue(variant.condition).length > 0
  );
}

export function getVariantConditionOptions<
  TVariant extends ProductDefaultVariantLike,
>(product: ProductWithDefaultVariantLike<TVariant>) {
  const explicitConditions = sortCanonicalProductConditionsByPreference(
    (product.variants || []).map((variant) =>
      normalizeConditionValue(variant.condition)
    )
  );

  if (explicitConditions.length === 0) {
    const normalizedProductCondition = normalizeConditionValue(
      product.condition
    );
    return normalizedProductCondition ? [normalizedProductCondition] : [];
  }

  return explicitConditions;
}

function sortByDefaultPreference<TVariant extends ProductDefaultVariantLike>(
  basePrice: number,
  getCondition: (candidate: VariantCandidate<TVariant>) => string,
  candidates: VariantCandidate<TVariant>[]
) {
  return [...candidates].sort((left, right) => {
    // Match the SQL default-variant projection:
    // condition preference first, then price ascending, then original index.
    const leftConditionRank = getConditionPreferenceRank(getCondition(left));
    const rightConditionRank = getConditionPreferenceRank(getCondition(right));

    if (leftConditionRank !== rightConditionRank) {
      return leftConditionRank - rightConditionRank;
    }

    const leftPrice = getVariantPrice(basePrice, left.variant);
    const rightPrice = getVariantPrice(basePrice, right.variant);

    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    return left.index - right.index;
  });
}

function toResolvedSelection<TVariant extends ProductDefaultVariantLike>(
  product: ProductWithDefaultVariantLike<TVariant>,
  variant: TVariant
): ResolvedProductVariantSelection<TVariant> {
  const attributes = normalizeSelectedAttributes(variant.attributes);
  const storage = normalizeAttributeValue(attributes.storage);
  const color = normalizeAttributeValue(attributes.color);
  const condition = getVariantCondition(product, variant);

  return {
    variant,
    attributes,
    storage: storage || undefined,
    color: color || undefined,
    condition: condition || undefined,
    price: getVariantPrice(product.price, variant),
    compareAtPrice:
      typeof variant.compare_at_price === 'number'
        ? variant.compare_at_price
        : typeof product.compare_at_price === 'number'
          ? product.compare_at_price
          : undefined,
  };
}

export function resolveDefaultVariantSelection<
  TVariant extends ProductDefaultVariantLike,
>(
  product: ProductWithDefaultVariantLike<TVariant>,
  options?: { condition?: string | null }
) {
  const variants = product.variants || [];
  if (variants.length === 0) {
    return null;
  }

  const requestedCondition = normalizeConditionValue(options?.condition);
  const usesConditionAxis = hasVariantConditionAxis(product);
  const purchasableVariants = variants
    .map((variant, index) => ({ variant, index }))
    .filter(({ variant }) =>
      isProductVariantPurchasable(product.manage_stock, variant)
    )
    .filter(({ variant }) => {
      if (!usesConditionAxis || !requestedCondition) {
        return true;
      }

      return getVariantCondition(product, variant) === requestedCondition;
    });

  if (purchasableVariants.length === 0) {
    return null;
  }

  const [defaultVariant] = sortByDefaultPreference(
    product.price,
    (candidate) => getVariantCondition(product, candidate.variant),
    purchasableVariants
  );

  return defaultVariant
    ? toResolvedSelection(product, defaultVariant.variant)
    : null;
}

/**
 * Like `resolveDefaultVariantSelection`, but ranks purely by the lowest in-stock
 * price, ignoring condition preference. Used ONLY by the OgaBassey PDP so the
 * page opens on the cheapest buyable option (e.g. a cheaper "Used" over a
 * pricier "Open Box"). The shared default resolver — which also feeds the
 * product feeds and the cart — keeps its condition-first ordering, so this does
 * not change advertised/cart pricing.
 */
export function resolveLowestPricedVariantSelection<
  TVariant extends ProductDefaultVariantLike,
>(product: ProductWithDefaultVariantLike<TVariant>) {
  const variants = product.variants || [];
  if (variants.length === 0) {
    return null;
  }

  const purchasableVariants = variants
    .map((variant, index) => ({ variant, index }))
    .filter(({ variant }) =>
      isProductVariantPurchasable(product.manage_stock, variant)
    );

  if (purchasableVariants.length === 0) {
    return null;
  }

  const [cheapest] = purchasableVariants.sort((left, right) => {
    const leftPrice = getVariantPrice(product.price, left.variant);
    const rightPrice = getVariantPrice(product.price, right.variant);
    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }
    return left.index - right.index;
  });

  return cheapest ? toResolvedSelection(product, cheapest.variant) : null;
}

function resolveVariantSelectionInternal<
  TVariant extends ProductDefaultVariantLike,
>(
  product: ProductWithDefaultVariantLike<TVariant>,
  options: {
    attributes?: Record<string, string | null | undefined> | null;
    condition?: string | null;
    variantId?: string | null;
  },
  config: {
    includeOutOfStock: boolean;
  }
) {
  const variants = product.variants || [];
  if (variants.length === 0) {
    return null;
  }

  const normalizedAttributes = normalizeSelectedAttributes(options.attributes);
  const requestedCondition = normalizeConditionValue(options.condition);
  const attributeKeys = Object.keys(normalizedAttributes);
  const usesConditionAxis = hasVariantConditionAxis(product);
  const variantCandidates = variants
    .map((variant, index) => ({ variant, index }))
    .filter(({ variant }) =>
      config.includeOutOfStock
        ? true
        : isProductVariantPurchasable(product.manage_stock, variant)
    );

  if (variantCandidates.length === 0) {
    return null;
  }

  if (options.variantId) {
    const exactVariant = variantCandidates.find(
      ({ variant }) => variant.id === options.variantId
    );

    if (exactVariant) {
      return toResolvedSelection(product, exactVariant.variant);
    }
  }

  if (attributeKeys.length > 0) {
    const matchingVariants = variantCandidates.filter(({ variant }) => {
      const variantAttributes = normalizeSelectedAttributes(variant.attributes);

      return attributeKeys.every(
        (key) => variantAttributes[key] === normalizedAttributes[key]
      );
    });

    if (matchingVariants.length === 0) {
      return null;
    }

    const conditionScopedMatches =
      usesConditionAxis && requestedCondition
        ? matchingVariants.filter(
            ({ variant }) =>
              getVariantCondition(product, variant) === requestedCondition
          )
        : matchingVariants;

    if (conditionScopedMatches.length === 0) {
      return null;
    }

    if (usesConditionAxis && !requestedCondition) {
      const distinctConditions = new Set(
        conditionScopedMatches
          .map(({ variant }) => getVariantCondition(product, variant))
          .filter(Boolean)
      );

      if (distinctConditions.size > 1) {
        return null;
      }
    }

    return toResolvedSelection(
      product,
      sortByDefaultPreference(
        product.price,
        (candidate) => getVariantCondition(product, candidate.variant),
        conditionScopedMatches
      )[0].variant
    );
  }

  if (requestedCondition && usesConditionAxis) {
    const conditionMatches = variantCandidates.filter(
      ({ variant }) =>
        getVariantCondition(product, variant) === requestedCondition
    );

    if (conditionMatches.length === 0) {
      return null;
    }

    return toResolvedSelection(
      product,
      sortByDefaultPreference(
        product.price,
        (candidate) => getVariantCondition(product, candidate.variant),
        conditionMatches
      )[0].variant
    );
  }

  return null;
}

export function resolveVariantDisplaySelection<
  TVariant extends ProductDefaultVariantLike,
>(
  product: ProductWithDefaultVariantLike<TVariant>,
  options: {
    attributes?: Record<string, string | null | undefined> | null;
    condition?: string | null;
    variantId?: string | null;
  }
) {
  return resolveVariantSelectionInternal(product, options, {
    includeOutOfStock: true,
  });
}

export function resolveVariantSelection<
  TVariant extends ProductDefaultVariantLike,
>(
  product: ProductWithDefaultVariantLike<TVariant>,
  options: {
    attributes?: Record<string, string | null | undefined> | null;
    condition?: string | null;
    variantId?: string | null;
  }
) {
  return resolveVariantSelectionInternal(product, options, {
    includeOutOfStock: false,
  });
}
