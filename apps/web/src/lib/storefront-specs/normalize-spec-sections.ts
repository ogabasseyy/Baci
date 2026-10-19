import { normalizeSpecItems } from './normalize-spec-items';
import type { ProductSpecSection } from './spec-data';
import { normalizeSpecValueText } from './spec-value-normalization';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeSpecSections(value: unknown): ProductSpecSection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((section) => {
    if (!isRecord(section)) {
      return [];
    }

    const items = normalizeSpecItems(section.items);
    if (items.length === 0) {
      return [];
    }

    return [
      {
        category: normalizeSpecValueText(section.category) || 'General',
        items,
      },
    ];
  });
}
