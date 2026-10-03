import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import type { ProductConditionOffer } from '@/types/product';

export function findMatchingConditionOffer(
  offers: ProductConditionOffer[] | null | undefined,
  selectedCondition: string | null,
  preferredOfferId?: string | null
): ProductConditionOffer | null {
  if (!offers?.length) {
    return null;
  }

  // Honor the search-advertised offer when it belongs to this product and
  // matches the requested condition, so the PDP charges the price the
  // search card displayed. Unknown or mismatched ids fall through to the
  // default selection.
  if (preferredOfferId) {
    const preferred = offers.find(
      (offer) => String(offer.id) === String(preferredOfferId)
    );
    if (preferred) {
      const normalizedPreferredCondition = normalizeCanonicalProductCondition(
        preferred.condition
      );
      const normalizedSelectedCondition =
        normalizeCanonicalProductCondition(selectedCondition);
      if (
        normalizedPreferredCondition &&
        (normalizedSelectedCondition
          ? normalizedPreferredCondition === normalizedSelectedCondition
          : offers.length === 1)
      ) {
        return preferred;
      }
    }
  }

  if (!selectedCondition) {
    return offers.length === 1 ? offers[0] : null;
  }

  const normalizedSelectedCondition =
    normalizeCanonicalProductCondition(selectedCondition);

  return (
    offers.find((offer) => offer.condition === selectedCondition) ??
    (normalizedSelectedCondition
      ? offers.find(
          (offer) =>
            normalizeCanonicalProductCondition(offer.condition) ===
            normalizedSelectedCondition
        )
      : undefined) ??
    null
  );
}
