import { selectConditionOffer } from '@baci/shared/lib';
import type { ProductConditionOffer } from '@/types/product';

export function findMatchingConditionOffer(
  offers: ProductConditionOffer[] | null | undefined,
  selectedCondition: string | null,
  preferredOfferId?: string | null,
  suppressMatch?: boolean
): ProductConditionOffer | null {
  // Identity resolves through the shared offer authority: the
  // search-advertised id wins when it names a member matching the
  // selection (so the PDP charges the price the card displayed), then
  // the exact spelling, then the first canonical match. Unknown or
  // mismatched ids fall through to the default selection, and
  // base-row entries suppress the match to keep the advertised price.
  return (
    selectConditionOffer(offers, {
      selectedCondition,
      preferredOfferId,
      suppressMatch,
      preferExactConditionMatch: true,
    }) ?? null
  );
}
