import { compareConditionOfferIdentity } from './compare-condition-offer-identity';
import { normalizeCanonicalProductCondition } from './product-condition';

export interface SelectableConditionOffer {
  id: string | number;
  condition?: string | null;
}

export interface ConditionOfferSelection {
  /** Canonical-or-raw selected condition; null/undefined selects nothing. */
  selectedCondition?: string | null;
  /** Advertised offer id (search/compare/route); honored on match. */
  preferredOfferId?: string | null;
  /**
   * Ordered advertised ids (explicit pick before route id); each is
   * honored on match before the condition fallback. Appended after
   * `preferredOfferId` when both are given.
   */
  preferredOfferIds?: ReadonlyArray<string | null | undefined>;
  /** Base-row entries suppress the match to keep the advertised price. */
  suppressMatch?: boolean;
  /**
   * Parent condition: same-condition selections belong to the parent
   * family, so the condition fallback resolves nothing. The preferred
   * id is still honored above this gate (explicit picks win).
   */
  parentCondition?: string | null;
  /** Prefer a raw condition spelling over an earlier canonical alias. */
  preferExactConditionMatch?: boolean;
}

/**
 * Offer identity for a selected condition, shared by the web PDP, the
 * native PDP, and the ogabassey PDP: suppression wins, then each
 * advertised id in order (when it names a member matching the
 * selection), then the condition fallback (exact spelling first when
 * requested, else the first canonical match, excluding the parent
 * family's own condition). A missing selection resolves only a
 * single-offer catalog.
 *
 * The condition fallback orders by raw condition, then offer id
 * (shared comparator with the feed dedup): same-condition offers
 * carry distinct prices, so input-order dependence would price
 * nondeterministically across snapshot hydration orders, and an
 * id-only order would disagree with the feed whenever two raw
 * conditions share one canonical condition (refurbished/open_box).
 * This matches the RPC's (condition, id) emission order and the feed
 * dedup that keeps the first row per normalized condition.
 */
export function selectConditionOffer<T extends SelectableConditionOffer>(
  offers: readonly T[] | null | undefined,
  selection: ConditionOfferSelection = {}
): T | null {
  if (selection.suppressMatch) return null;
  if (!offers || offers.length === 0) return null;
  const {
    selectedCondition,
    preferredOfferId,
    preferredOfferIds,
    parentCondition,
    preferExactConditionMatch,
  } = selection;
  const normalizedSelected = selectedCondition
    ? normalizeCanonicalProductCondition(selectedCondition)
    : '';

  const orderedPreferredIds = [
    ...(preferredOfferId != null && preferredOfferId !== ''
      ? [preferredOfferId]
      : []),
    ...(preferredOfferIds ?? []).filter(
      (id): id is string => id != null && id !== ''
    ),
  ];
  for (const candidateId of orderedPreferredIds) {
    const preferred = offers.find(
      (offer) => String(offer.id) === String(candidateId)
    );
    if (!preferred) continue;
    if (normalizedSelected) {
      const normalizedPreferred = normalizeCanonicalProductCondition(
        preferred.condition ?? ''
      );
      if (
        normalizedPreferred !== '' &&
        normalizedPreferred === normalizedSelected
      ) {
        return preferred;
      }
    } else if (offers.length === 1) {
      return preferred;
    }
  }

  // The single-offer shortcut applies only when no condition was
  // supplied at all (raw falsy): a supplied-but-unnormalizable
  // condition resolved to no offer in every previous implementation,
  // so it must not price the sole offer under an unselected condition.
  if (!selectedCondition) {
    return offers.length === 1 ? offers[0] : null;
  }

  // Same-condition selections belong to the parent family, never to an
  // offer row (a null parent defaults to `new`, matching the PDP rule
  // that never purchases through a same-condition offer).
  if (parentCondition !== undefined) {
    const normalizedParent =
      normalizeCanonicalProductCondition(parentCondition ?? '') || 'new';
    if (normalizedSelected === normalizedParent) return null;
  }

  const ordered = [...offers].sort(compareConditionOfferIdentity);
  if (preferExactConditionMatch) {
    const exact = ordered.find(
      (offer) => (offer.condition ?? null) === selectedCondition
    );
    if (exact) return exact;
  }
  // Supplied but unnormalizable (and no exact spelling): no canonical
  // match is possible — never fall through to a ''-condition row.
  if (!normalizedSelected) return null;
  return (
    ordered.find(
      (offer) =>
        normalizeCanonicalProductCondition(offer.condition ?? '') ===
        normalizedSelected
    ) ?? null
  );
}
