import {
  type CriticalAxisVariant,
  getInapplicableCriticalVariantAxes,
} from './critical-applicable-variant-axes';

interface ResolveMissingCriticalVariantAxesInput {
  explicitSelectedAxes: string[];
  hiddenRequiredVariantAxes: string[];
  renderableVariantAxes: string[];
  resolvedVariant?: CriticalAxisVariant | null;
  selectedAttributes: Record<string, string>;
  variants: readonly CriticalAxisVariant[] | null | undefined;
}

/**
 * The option groups the shopper still has to choose from. A group is
 * only required when the selection can have a value there: a Used
 * console with no region must not wait on a region that only the New
 * consoles carry.
 */
export function resolveMissingCriticalVariantAxes({
  explicitSelectedAxes,
  hiddenRequiredVariantAxes,
  renderableVariantAxes,
  resolvedVariant,
  selectedAttributes,
  variants,
}: ResolveMissingCriticalVariantAxesInput) {
  const inapplicableAxes = getInapplicableCriticalVariantAxes(
    variants,
    selectedAttributes,
    [...renderableVariantAxes, ...hiddenRequiredVariantAxes],
    resolvedVariant
  );

  return {
    missingHiddenRequiredVariantAxes: hiddenRequiredVariantAxes.filter(
      (axis) =>
        !inapplicableAxes.includes(axis) &&
        !(explicitSelectedAxes.includes(axis) && selectedAttributes[axis])
    ),
    missingRenderableVariantAxes: renderableVariantAxes.filter(
      (axis) => !selectedAttributes[axis] && !inapplicableAxes.includes(axis)
    ),
  };
}
