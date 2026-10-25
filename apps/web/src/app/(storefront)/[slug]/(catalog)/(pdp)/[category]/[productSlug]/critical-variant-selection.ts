import {
  type ResolvedProductVariantSelection,
  resolveDefaultVariantSelection,
  resolveLowestPricedVariantSelection,
  resolveVariantSelection,
  resolveVariantSelectionParamResolution,
} from '@baci/shared/lib';
import { canonicalizeVariantAxis } from '@/components/storefront/ogabassey/variant-attributes';
import type { Product, ProductVariant } from '@/lib/products';
import { filterDefaultAdvertisedVariants } from '@/lib/storefront-variant-disclosure';

export type CategoryProductRouteSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function normalizeRouteSelectionValue(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRouteVariantAxis(axis: string) {
  const normalizedAxis = canonicalizeVariantAxis(axis);
  return normalizedAxis === 'colour' ? 'color' : normalizedAxis;
}

function normalizeRouteVariantAttributes(
  attributes: Record<string, string> | null | undefined
) {
  const normalizedAttributes: Record<string, string> = {};

  for (const [rawAxis, rawValue] of Object.entries(attributes || {})) {
    const axis = normalizeRouteVariantAxis(rawAxis);
    const value = normalizeRouteSelectionValue(rawValue);
    if (axis && value) {
      normalizedAttributes[axis] = value;
    }
  }

  return normalizedAttributes;
}

export function normalizeRouteProductVariants(
  variants: NonNullable<Product['variants']>
) {
  return variants.map((variant) => ({
    ...variant,
    attributes: normalizeRouteVariantAttributes(variant.attributes),
  }));
}

export function getVariantPrimaryImage(
  variant: NonNullable<Product['variants']>[number] | null | undefined
) {
  if (!variant || typeof variant !== 'object') {
    return null;
  }

  return variant.primary_image || variant.images?.[0] || null;
}

export function shouldRedirectVariantSelectionParams(
  product: Product,
  searchParams: CategoryProductRouteSearchParams
) {
  if (!product.variants || product.variants.length === 0) {
    return false;
  }

  // An unknown exact variant id is NOT redirected (mirrors the products
  // PDP resolver): stripping the param would silently render the default
  // variant at a different price. The shared client surfaces the dead
  // link as missing instead (routeVariantMissing).
  const selectionResolution = resolveVariantSelectionParamResolution(
    product,
    searchParams
  );

  return (
    selectionResolution.type === 'attribute_only' ||
    selectionResolution.type === 'ambiguous' ||
    selectionResolution.type === 'zero_match'
  );
}

function toInitialCriticalVariantSelection(
  selection: ResolvedProductVariantSelection<ProductVariant> | null,
  options: { includeCondition?: boolean } = {}
) {
  if (!selection) {
    return undefined;
  }

  const variantId = selection.variant.id;
  if (!selection.attributes && !selection.condition && !variantId) {
    return undefined;
  }

  return {
    ...(selection.attributes && { attributes: selection.attributes }),
    ...(options.includeCondition !== false &&
      selection.condition && { condition: selection.condition }),
    ...(variantId && { variantId }),
  };
}

function getPriceFirstCriticalVariantSelection(product: Product) {
  const normalizedProduct = {
    ...product,
    variants: filterDefaultAdvertisedVariants(
      normalizeRouteProductVariants(product.variants || []),
      product
    ),
  };

  return toInitialCriticalVariantSelection(
    resolveLowestPricedVariantSelection(normalizedProduct) ??
      resolveDefaultVariantSelection(normalizedProduct),
    { includeCondition: false }
  );
}

function getDefaultCriticalVariantSelection(product: Product) {
  // No explicit query selection: open on the GLOBAL cheapest purchasable
  // variant (the merchant's "lowest-priced default"). product.default_variant_id
  // is the SKU projection's condition-first default — not an explicit shopper
  // choice — so it is intentionally ignored here; honoring it would seed/preload
  // the pricier condition-first SKU above the fold and then flip to the cheapest
  // after hydration, and it would disagree with the non-critical hook (which
  // also opens on the cheapest). URL-supplied variantId selections are resolved
  // by the caller's non-"none" path before this default is used.
  return getPriceFirstCriticalVariantSelection(product);
}

export function getInitialCriticalVariantSelection(
  product: Product,
  searchParams: CategoryProductRouteSearchParams
) {
  if (!product.variants || product.variants.length === 0) {
    return undefined;
  }

  const selectionResolution = resolveVariantSelectionParamResolution(
    product,
    searchParams
  );

  if (selectionResolution.type === 'none') {
    return getDefaultCriticalVariantSelection(product);
  }

  const [match] = selectionResolution.matches;
  const attributes =
    selectionResolution.type === 'variant_id'
      ? match?.attributes
      : selectionResolution.type === 'condition_with_attributes' ||
          selectionResolution.type === 'attribute_only'
        ? selectionResolution.selectionInput.attributes
        : undefined;
  const condition =
    selectionResolution.selectionInput.condition ||
    match?.condition ||
    undefined;
  const variantId =
    selectionResolution.type === 'variant_id'
      ? selectionResolution.selectionInput.variantId
      : undefined;

  if (!attributes && !condition && !variantId) {
    return undefined;
  }

  return {
    ...(attributes && { attributes }),
    ...(condition && { condition }),
    ...(variantId && { variantId }),
  };
}

export function getInitialCriticalVariantSelectionPrimaryImage(
  product: Product,
  selection: ReturnType<typeof getInitialCriticalVariantSelection>
) {
  if (!selection) {
    return null;
  }

  const normalizedProduct = {
    ...product,
    variants: normalizeRouteProductVariants(product.variants || []),
  };

  return getVariantPrimaryImage(
    resolveVariantSelection(normalizedProduct, selection)?.variant
  );
}
