import { normalizeProductSchemaSpecLabel } from '@/lib/normalize-product-schema-spec-label';
import { getProductSchemaSpecKeyForLabel } from '@/lib/product-schema-spec-vocabulary';
import { isUnsupportedSpecValue } from './is-unsupported-spec-value';
import type { ProductSpecItem } from './spec-data';

interface DedupeSpecItemsOptions {
  omitUnsupportedValues?: boolean;
  section?: string;
}

function getCanonicalSpecLabel(label: string, section?: string) {
  const vocabularyKey = getProductSchemaSpecKeyForLabel(label, section);
  if (vocabularyKey) {
    return vocabularyKey;
  }

  const canonicalLabel = normalizeProductSchemaSpecLabel(label).trim();

  const fallbackLabel = label.trim().replace(/\s+/g, ' ').toLowerCase();
  return (
    canonicalLabel ||
    Array.from(fallbackLabel)
      .map((character) => character.codePointAt(0)?.toString(16))
      .join('-')
  );
}

function getSpecItemIdentity(label: string, section?: string) {
  const sourceSection = section || 'General';
  const normalizedSection =
    normalizeProductSchemaSpecLabel(sourceSection).trim() ||
    sourceSection.trim().replace(/\s+/g, ' ').toLowerCase();

  return `${normalizedSection}:${getCanonicalSpecLabel(label, section)}`;
}

function getSpecValueQuality(value: string) {
  if (!isUnsupportedSpecValue(value)) {
    return 2;
  }

  return ['false', 'no'].includes(value.trim().toLowerCase()) ? 1 : 0;
}

export function dedupeSpecItems(
  items: ProductSpecItem[],
  options: DedupeSpecItemsOptions = {}
): ProductSpecItem[] {
  const itemIndexes = new Map<string, number>();
  const dedupedItems: ProductSpecItem[] = [];

  for (const item of items) {
    const itemValueQuality = getSpecValueQuality(item.value);
    const unsupportedValue = itemValueQuality < 2;
    if (options.omitUnsupportedValues && unsupportedValue) {
      continue;
    }

    const identity = getSpecItemIdentity(item.label, options.section);
    const existingIndex = itemIndexes.get(identity);
    if (existingIndex === undefined) {
      itemIndexes.set(identity, dedupedItems.length);
      dedupedItems.push(item);
      continue;
    }

    const existingItem = dedupedItems[existingIndex];
    if (itemValueQuality > getSpecValueQuality(existingItem.value)) {
      dedupedItems[existingIndex] = item;
    }
  }

  return dedupedItems;
}
