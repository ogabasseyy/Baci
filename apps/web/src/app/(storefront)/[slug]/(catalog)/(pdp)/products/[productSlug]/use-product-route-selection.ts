import {
  getVariantConditionOptions,
  hasVariantConditionAxis,
  normalizeCanonicalProductCondition,
  resolveDefaultVariantSelection,
  resolveVariantSelectionParamResolution,
} from '@baci/shared/lib';
import { useSearchParams } from 'next/navigation';
import type { Product } from '@/lib/products';
import { getValidConditionOptions } from './product-selection-utils';

/**
 * Route-driven selection inputs for the PDP: variant attributes, condition,
 * and the forwarded matched-offer id. Pure derivation from the URL and the
 * product — no selection state lives here.
 */
export function useProductRouteSelection(product: Product) {
  const searchParams = useSearchParams();
  const conditionParam = searchParams.get('condition');
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
    (!usesVariantRouteSelection ? conditionParam : undefined);
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
  // Search/compare entry points forward the advertised matched offer id.
  const offerIdParam = searchParams.get('offer_id');
  return {
    availableConditionOptions,
    defaultVariantSelection,
    offerIdParam,
    routeCondition,
    routeSelectionAttributes,
    routeVariantId,
    usesVariantConditions,
    usesVariantRouteSelection,
  };
}
