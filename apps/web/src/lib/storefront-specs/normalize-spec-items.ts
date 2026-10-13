import { dedupeSpecItems } from './dedupe-spec-items';
import type { ProductSpecItem } from './spec-data';
import { normalizeSpecValueText } from './spec-value-normalization';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeSpecItems(value: unknown): ProductSpecItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeSpecItems(
    value.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const label = normalizeSpecValueText(item.label);
      const itemValue = normalizeSpecValueText(item.value);

      return label && itemValue ? [{ label, value: itemValue }] : [];
    })
  );
}
