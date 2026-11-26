import { normalizeCanonicalProductCondition } from '@baci/shared/lib/product-condition';
import type { CriticalCartVariant } from './critical-cart-product';
import { normalizeCriticalVariantAttributes } from './critical-commerce-selection';

export type CriticalAxisVariant = Pick<
  CriticalCartVariant,
  'attributes' | 'condition'
>;

function readVariantAxisValues(variant: CriticalAxisVariant) {
  const attributes = normalizeCriticalVariantAttributes(variant.attributes);
  const condition =
    attributes.condition ||
    normalizeCanonicalProductCondition(variant.condition ?? '');

  return condition ? { ...attributes, condition } : attributes;
}

function sameOption(left: string | undefined, right: string | undefined) {
  return (
    Boolean(left) &&
    Boolean(right) &&
    left?.trim().toLowerCase() === right?.trim().toLowerCase()
  );
}

/**
 * Option groups the shopper cannot be asked to choose from for the
 * current selection: no variant matching the other chosen options has
 * a value on that axis (for example a Used console with no region while
 * every New console has one). Demanding a choice there makes the
 * selection unbuyable, because picking any option leaves it.
 *
 * `resolvedVariant` is the exact version the selection already
 * resolves to (for example the advertised default). Its own blanks are
 * never required either, so a version that differs from a sibling only
 * by a blank option stays buyable.
 */
export function getInapplicableCriticalVariantAxes(
  variants: readonly CriticalAxisVariant[] | null | undefined,
  selectedAttributes: Record<string, string>,
  axes: string[],
  resolvedVariant?: CriticalAxisVariant | null
): string[] {
  const variantValues = (variants ?? []).map(readVariantAxisValues);
  const resolvedValues = resolvedVariant
    ? readVariantAxisValues(resolvedVariant)
    : null;

  return axes.filter((axis) => {
    if (selectedAttributes[axis]) {
      return false;
    }
    if (resolvedValues && !resolvedValues[axis]) {
      return true;
    }

    // A blank is "no value", not a wildcard: a version with no storage
    // is not a 256GB version. Only when nothing matches exactly (the
    // selection carries an option some versions never record) do blanks
    // count as compatible.
    const matchesSelection = (
      values: Record<string, string>,
      blankIsCompatible: boolean
    ) =>
      Object.entries(selectedAttributes).every(
        ([selectedAxis, selectedValue]) =>
          selectedAxis === axis ||
          !selectedValue ||
          (blankIsCompatible && !values[selectedAxis]) ||
          sameOption(values[selectedAxis], selectedValue)
      );
    const exact = variantValues.filter((values) =>
      matchesSelection(values, false)
    );
    const matching =
      exact.length > 0
        ? exact
        : variantValues.filter((values) => matchesSelection(values, true));

    return matching.length > 0 && matching.every((values) => !values[axis]);
  });
}
