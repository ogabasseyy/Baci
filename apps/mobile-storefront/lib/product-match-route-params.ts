import type { RefinedSearchRow } from '@baci/shared/lib';

export interface SearchMatchRouteParams {
  variant_id?: string;
  offer_id?: string;
  condition?: string;
  match_base?: '1';
}

/**
 * Builds the PDP route params that preserve a search/comparison match.
 *
 * An exact option id resolves its own live condition on the PDP, so the
 * snapshot condition is forwarded only for ID-less base-row matches — and
 * those carry an explicit `match_base` identity so the PDP keeps the
 * advertised base price instead of resolving a same-condition offer.
 */
export function buildSearchMatchRouteParams(
  searchMatch: RefinedSearchRow | null | undefined
): SearchMatchRouteParams {
  const variantId = searchMatch?.variantId;
  const offerId = searchMatch?.offerId;
  const hasExactMatchIdentity = Boolean(variantId || offerId);
  return {
    ...(variantId ? { variant_id: variantId } : {}),
    ...(offerId ? { offer_id: offerId } : {}),
    ...(searchMatch?.condition && !hasExactMatchIdentity
      ? { condition: searchMatch.condition }
      : {}),
    ...(searchMatch && !hasExactMatchIdentity ? { match_base: '1' } : {}),
  };
}
