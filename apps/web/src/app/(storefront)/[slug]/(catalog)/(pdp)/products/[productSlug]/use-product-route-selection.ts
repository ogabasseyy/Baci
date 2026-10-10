import {
  getVariantConditionOptions,
  hasVariantConditionAxis,
  normalizeCanonicalProductCondition,
  resolveDefaultVariantSelection,
  resolveVariantSelectionParamResolution,
} from '@baci/shared/lib';
import { useSearchParams } from 'next/navigation';
import type { Product } from '@/lib/products';
import { getValidConditionOptions } from './product-selection-condition';

/**
 * Route-driven selection inputs for the PDP: variant attributes, condition,
 * and the forwarded matched-offer id. Pure derivation from the URL and the
 * product — no selection state lives here.
 */
export function useProductRouteSelection(product: Product) {
  const searchParams = useSearchParams();
  const conditionParam = searchParams.get('condition');
  const offerIdParam = searchParams.get('offer_id');
  // Search/compare entry points mark ID-less base-row matches explicitly
  // (mirrors native): without this identity the entry condition is
  // indistinguishable from a condition-offer selection.
  const routeBaseMatch = searchParams.get('match_base') === '1';
  const usesVariantRouteSelection = Boolean(
    product.has_variants && product.variants && product.variants.length > 0
  );
  const routeSelectionResolution = usesVariantRouteSelection
    ? resolveVariantSelectionParamResolution(product, searchParams)
    : null;
  const routeSelectionInput = routeSelectionResolution?.selectionInput ?? {};
  const routeSelectionAttributes = (routeSelectionInput.attributes ??
    {}) as Record<string, string>;
  const routeConditionSource =
    routeSelectionInput.condition ??
    (!usesVariantRouteSelection
      ? (conditionParam ??
        product.offers?.find((offer) => String(offer.id) === offerIdParam)
          ?.condition)
      : undefined);
  const routeCondition =
    normalizeCanonicalProductCondition(routeConditionSource);
  const routeVariantId = routeSelectionInput.variantId ?? undefined;
  const defaultVariantSelection = usesVariantRouteSelection
    ? resolveDefaultVariantSelection(product, { condition: routeCondition })
    : null;
  const usesVariantConditions = usesVariantRouteSelection
    ? hasVariantConditionAxis(product)
    : false;
  const availableConditionOptions = usesVariantConditions
    ? getValidConditionOptions(getVariantConditionOptions(product))
    : [];
  // ID-only comparison links derive condition from this product's live offer.
  // Explicit condition constraints remain authoritative when supplied.
  return {
    availableConditionOptions,
    defaultVariantSelection,
    offerIdParam,
    routeBaseMatch,
    routeCondition,
    routeSelectionAttributes,
    routeVariantId,
    usesVariantConditions,
    usesVariantRouteSelection,
  };
}
