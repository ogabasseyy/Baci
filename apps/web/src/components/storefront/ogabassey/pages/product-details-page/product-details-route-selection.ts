import {
  normalizeCanonicalProductCondition,
  resolveVariantSelectionParamResolution,
  type ProductDefaultVariantLike,
  type ProductWithSelectionAxesLike,
  type SearchParamSource,
} from '@baci/shared/lib';
import type { ProductConditionOffer } from '../../types';

export interface ProductDetailsRouteSelection {
  routeCondition: ReturnType<typeof normalizeCanonicalProductCondition>;
  routeOfferId: string | null;
  routeOfferMissing: boolean;
  routeSelectionAttributes: Record<string, string>;
  routeSelectionAttributesKey: string;
  routeVariantId: string | undefined;
}

/**
 * Route-driven selection inputs for the categorized PDP: variant
 * attributes, condition, and the forwarded matched-offer id. Pure
 * derivation from the URL and the product — no selection state lives here.
 * ID-only search links derive condition from this product's live offer
 * (mirrors the generic PDP route selection): the card deliberately omits
 * the snapshot condition, so without this the PDP would open the parent
 * default instead of the advertised offer. Explicit condition constraints
 * remain authoritative when supplied.
 */
export function resolveProductDetailsRouteSelection<
  TVariant extends ProductDefaultVariantLike,
>(args: {
  offers: ProductConditionOffer[] | undefined;
  resolutionProduct: ProductWithSelectionAxesLike<TVariant>;
  searchParams: SearchParamSource & { get(name: string): string | null };
  usesVariantRouteSelection: boolean;
}): ProductDetailsRouteSelection {
  const {
    offers,
    resolutionProduct,
    searchParams,
    usesVariantRouteSelection,
  } = args;
  const rawConditionParam = searchParams.get('condition');
  const rawOfferIdParam = searchParams.get('offer_id');
  const routeSelectionResolution = usesVariantRouteSelection
    ? resolveVariantSelectionParamResolution(resolutionProduct, searchParams)
    : null;
  const routeSelectionInput = routeSelectionResolution?.selectionInput ?? {};
  const routeSelectionAttributes = routeSelectionInput.attributes || {};
  const routeSelectionAttributesKey = JSON.stringify(routeSelectionAttributes);
  const routeOfferId =
    rawOfferIdParam &&
    offers?.some((offer) => String(offer.id) === rawOfferIdParam)
      ? rawOfferIdParam
      : null;
  // Exact-match contract (mirrors the generic PDP and native route data):
  // a nonempty link offer id absent from the hydrated offers means the
  // offer was removed, deactivated, or sold — surface it as missing
  // instead of silently falling back to the parent/default price.
  const routeOfferMissing =
    Boolean(rawOfferIdParam) &&
    Array.isArray(offers) &&
    !offers.some((offer) => String(offer.id) === rawOfferIdParam);
  const routeConditionSource =
    routeSelectionInput.condition ??
    (!usesVariantRouteSelection
      ? (rawConditionParam ??
        offers?.find((offer) => String(offer.id) === rawOfferIdParam)
          ?.condition)
      : undefined);
  const routeCondition =
    normalizeCanonicalProductCondition(routeConditionSource);
  const routeVariantId =
    usesVariantRouteSelection && routeSelectionInput.variantId
      ? routeSelectionInput.variantId
      : undefined;
  return {
    routeCondition,
    routeOfferId,
    routeOfferMissing,
    routeSelectionAttributes,
    routeSelectionAttributesKey,
    routeVariantId,
  };
}
