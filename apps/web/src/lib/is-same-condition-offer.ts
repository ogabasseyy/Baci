import { normalizeCanonicalProductCondition } from '@baci/shared/lib';

function normalizeOfferCondition(value: unknown): string | undefined {
  return (
    (typeof value === 'string'
      ? normalizeCanonicalProductCondition(value)
      : '') || undefined
  );
}

/**
 * Mirror the categorized PDP ("Filter offers to exclude main product
 * condition"): an offer row carrying the parent product's own condition is
 * not a selectable alternate, so it must not mark the rail available or
 * advertise its price. The PDP defaults a legacy null parent condition to
 * `new`, so the comparison does the same; rows with an unknown OFFER
 * condition are kept fail-open.
 */
export function isSameConditionOffer(
  offerCondition: unknown,
  parentCondition: string | null | undefined
): boolean {
  const normalizedOffer = normalizeOfferCondition(offerCondition);
  if (normalizedOffer === undefined) return false;
  return normalizedOffer === normalizeOfferCondition(parentCondition ?? 'new');
}
