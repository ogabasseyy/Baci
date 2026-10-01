import {
  canonicalizeCommerceVariantAxis,
  normalizeCanonicalProductCondition,
  normalizeCommerceVariantOption,
} from '@baci/shared/lib';
import { normalizeCriticalVariantAttributes } from './critical-commerce-selection';

interface BuildCriticalInitialVariantIntentInput {
  attributes?: Record<string, unknown> | null;
  condition?: string | null;
  requiredAxes: string[];
}

export function buildCriticalInitialVariantIntent({
  attributes,
  condition,
  requiredAxes,
}: BuildCriticalInitialVariantIntentInput) {
  const requiredAxisSet = new Set(requiredAxes);
  const normalizedAttributes = normalizeCriticalVariantAttributes(attributes);
  const selectableAttributes = Object.fromEntries(
    Object.entries(normalizedAttributes).flatMap(([axis, value]) => {
      const canonicalAxis = canonicalizeCommerceVariantAxis(axis);
      if (!(canonicalAxis && requiredAxisSet.has(canonicalAxis))) {
        return [];
      }

      const normalizedValue =
        canonicalAxis === 'condition'
          ? normalizeCanonicalProductCondition(value)
          : normalizeCommerceVariantOption(canonicalAxis, value);
      return normalizedValue ? [[canonicalAxis, normalizedValue]] : [];
    })
  );
  const explicitCondition =
    normalizeCanonicalProductCondition(
      selectableAttributes.condition ?? condition
    ) || undefined;
  const selectedAttributes = explicitCondition
    ? { ...selectableAttributes, condition: explicitCondition }
    : selectableAttributes;

  return {
    explicitCondition,
    explicitSelectedAxes: Object.keys(selectedAttributes),
    resolverAttributes: Object.fromEntries(
      Object.entries(selectableAttributes).filter(
        ([axis]) => axis !== 'condition'
      )
    ),
    selectedAttributes,
  };
}
