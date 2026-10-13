import type { FeedVariant } from './feed-types';
export function normalizeFeedVariantStringAttributes(
  attributes: FeedVariant['attributes']
): Record<string, string> | null {
  if (!attributes) {
    return null;
  }

  const normalizedAttributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalizedValue = value.trim();
    if (normalizedValue) {
      normalizedAttributes[key] = normalizedValue;
    }
  }

  return normalizedAttributes;
}
