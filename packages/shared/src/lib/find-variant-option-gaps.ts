import { canonicalizeCommerceVariantAxis } from './canonicalize-commerce-variant-axis';

export interface VariantOptionGap {
  /** Position of the version in the list that was checked. */
  variantIndex: number;
  /** Option groups other versions fill in that this version leaves blank. */
  missingAxes: string[];
}

/** Text, finite numbers and booleans are values; anything else is blank. */
function hasOptionValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return (
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function readFilledAxes(attributes: Record<string, unknown>): Set<string> {
  const filled = new Set<string>();
  for (const [key, value] of Object.entries(attributes)) {
    const axis = canonicalizeCommerceVariantAxis(key);
    if (axis && hasOptionValue(value)) {
      filled.add(axis);
    }
  }
  return filled;
}

/**
 * Finds versions of one product that leave blank an option group at
 * least one sibling version fills in (a Used console with no region
 * beside New consoles that have one). Shoppers pick a version by
 * tapping options, so a version with a blank can be hard or impossible
 * to pick. A group every version leaves blank is not a gap.
 */
export function findVariantOptionGaps(
  variants: ReadonlyArray<Record<string, unknown> | null | undefined>
): VariantOptionGap[] {
  const filledByVariant = variants.map((attributes) =>
    readFilledAxes(attributes ?? {})
  );
  const usedAxes = new Set<string>();
  for (const filled of filledByVariant) {
    for (const axis of filled) {
      usedAxes.add(axis);
    }
  }

  return filledByVariant.flatMap((filled, variantIndex) => {
    const missingAxes = [...usedAxes].filter((axis) => !filled.has(axis));
    return missingAxes.length > 0 ? [{ variantIndex, missingAxes }] : [];
  });
}
