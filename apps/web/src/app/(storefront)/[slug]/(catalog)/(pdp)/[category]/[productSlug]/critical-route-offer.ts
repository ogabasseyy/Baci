import type { InitialCriticalVariantSelection } from '@/components/storefront/ogabassey/pdp/critical-commerce-selection';
import type { CategoryProductRouteSearchParams } from './critical-variant-selection';

export interface CriticalRouteOfferInput {
  id: string | number | null | undefined;
  condition?: string | null;
  price?: number | null;
}

export interface CriticalRouteOffer {
  /**
   * Validated ?offer_id naming one of the hydrated active offers, else
   * null. The critical buy controls price from it and forward it into
   * the cart add.
   */
  offerId: string | null;
  /** Condition of the matched offer, for seeding the condition axis. */
  offerCondition: string | null;
  /** Price of the matched offer, for the server shell price fallback. */
  offerPrice: number | null;
  /**
   * Exact-match contract (mirrors product-details-route-selection): a
   * nonempty link offer id absent from the hydrated offers means the
   * offer was removed or deactivated — surface it as missing instead
   * of silently selling the parent/default selection.
   */
  missing: boolean;
}

/**
 * Route-driven exact-offer input for the categorized PDP critical
 * shell. Pure derivation from the URL and the hydrated offers — no
 * selection state lives here.
 */
export function resolveCriticalRouteOffer({
  offers,
  searchParams,
}: {
  offers: readonly CriticalRouteOfferInput[] | null | undefined;
  searchParams: CategoryProductRouteSearchParams;
}): CriticalRouteOffer {
  const raw = searchParams.offer_id;
  const rawOfferId = Array.isArray(raw) ? raw[0] : raw;
  const match =
    typeof rawOfferId === 'string' && rawOfferId !== ''
      ? (offers?.find((offer) => String(offer?.id) === rawOfferId) ?? null)
      : null;
  return {
    offerId: match ? String(match.id) : null,
    offerCondition: match?.condition ?? null,
    offerPrice:
      typeof match?.price === 'number' && Number.isFinite(match.price)
        ? match.price
        : null,
    missing:
      typeof rawOfferId === 'string' &&
      rawOfferId !== '' &&
      Array.isArray(offers) &&
      !match,
  };
}

/**
 * Seeds the critical condition axis from the matched route offer when
 * the URL carries no explicit condition of its own: search cards omit
 * the snapshot condition on exact-offer links, so without this the
 * buy box would open on the parent default instead of the advertised
 * offer. Never overrides an explicit condition.
 */
export function seedCriticalRouteOfferCondition(
  selection: InitialCriticalVariantSelection | undefined,
  routeOffer: CriticalRouteOffer
): InitialCriticalVariantSelection | undefined {
  if (
    !routeOffer.offerId ||
    !routeOffer.offerCondition ||
    selection?.condition
  ) {
    return selection;
  }
  return { ...selection, condition: routeOffer.offerCondition };
}
