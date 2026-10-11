import { normalizeCanonicalProductCondition } from '@baci/shared/lib';

export type HandoffOfferRow = {
  condition?: string | null;
  stock_quantity?: number | null;
};

/**
 * PDP parity for the offer boolean: the detail resolver drops offers
 * whose canonical condition matches the parent's, and selection claims
 * the condition on the first row per canonical condition (dropping it
 * on stock). A stocked later duplicate — or a same-condition row — is
 * unselectable there, so it must not advertise selection here either.
 * Rows arrive in (condition, id) window order, so first-seen is first.
 */
export function hasSelectableStockedOffer(
  offers: readonly HandoffOfferRow[] | null | undefined,
  parentCondition: string | null | undefined,
  quantity: number
): boolean {
  const parent = normalizeCanonicalProductCondition(parentCondition);
  const seen = new Set<string>();
  return (offers ?? []).some((offer) => {
    const canonical = normalizeCanonicalProductCondition(offer.condition);
    if (!canonical || canonical === parent) return false;
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return Number(offer.stock_quantity ?? 0) >= quantity;
  });
}
