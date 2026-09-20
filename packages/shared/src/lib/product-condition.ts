export type CanonicalProductCondition = 'new' | 'open_box' | 'used';
export type GoogleListingCondition = 'new' | 'refurbished' | 'used';

export const CANONICAL_PRODUCT_CONDITION_PREFERENCE = [
  'used',
  'open_box',
  'new',
] as const satisfies readonly CanonicalProductCondition[];

const CANONICAL_PRODUCT_CONDITIONS = new Set<CanonicalProductCondition>([
  'new',
  'open_box',
  'used',
]);

const SCHEMA_ITEM_CONDITION_URIS = {
  new: 'https://schema.org/NewCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
  used: 'https://schema.org/UsedCondition',
} as const;

export function getCanonicalProductConditionPreferenceRank(
  value: string | null | undefined
) {
  const normalized = normalizeCanonicalProductCondition(value);

  if (!normalized) {
    return CANONICAL_PRODUCT_CONDITION_PREFERENCE.length;
  }

  const rank = CANONICAL_PRODUCT_CONDITION_PREFERENCE.indexOf(normalized);
  return rank >= 0 ? rank : CANONICAL_PRODUCT_CONDITION_PREFERENCE.length;
}

export function sortCanonicalProductConditionsByPreference(
  values: Array<string | null | undefined>
) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeCanonicalProductCondition(value))
        .filter((value): value is CanonicalProductCondition => Boolean(value))
    )
  ).sort((left, right) => {
    const leftRank = getCanonicalProductConditionPreferenceRank(left);
    const rightRank = getCanonicalProductConditionPreferenceRank(right);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.localeCompare(right);
  });
}

export function normalizeCanonicalProductCondition(
  value: string | null | undefined
): CanonicalProductCondition | '' {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'uk_used') {
    return 'used';
  }

  if (normalized === 'refurbished') {
    return 'open_box';
  }

  return CANONICAL_PRODUCT_CONDITIONS.has(
    normalized as CanonicalProductCondition
  )
    ? (normalized as CanonicalProductCondition)
    : '';
}

export function formatCanonicalProductConditionLabel(
  value: string | null | undefined
): string | undefined {
  switch (normalizeCanonicalProductCondition(value)) {
    case 'new':
      return 'New';
    case 'used':
      return 'Used';
    case 'open_box':
      return 'Open Box';
    default:
      return undefined;
  }
}

export function toGoogleListingCondition(
  value: string | null | undefined
): GoogleListingCondition | undefined {
  switch (normalizeCanonicalProductCondition(value)) {
    case 'new':
      return 'new';
    case 'used':
      return 'used';
    case 'open_box':
      return 'refurbished';
    default:
      return undefined;
  }
}

export function toSchemaItemConditionUri(value: string | null | undefined) {
  const googleListingCondition = toGoogleListingCondition(value);

  return googleListingCondition
    ? SCHEMA_ITEM_CONDITION_URIS[googleListingCondition]
    : undefined;
}
