import type { ModelFamilyAuthorityEntry } from '@/lib/storefront-category/category-hub-types';

export function matchesProduct(
  entry: ModelFamilyAuthorityEntry,
  productName: string
) {
  const trimmed = productName.trim();
  if (entry.modelPatterns && entry.modelPatterns.length > 0) {
    return entry.modelPatterns.some((pattern) => pattern.test(trimmed));
  }
  return entry.productNamePattern.test(trimmed);
}

const BARE_SAMSUNG_MODEL_RIVALS =
  'Apple|iPhone|Oppo|Redmi|Vivo|Tecno|Infinix|Itel|Xiaomi|Honor|Google|OnePlus';

function matchesBareSamsungModel(content: string, letter: 'A' | 'S'): boolean {
  const rivalPattern = new RegExp(
    `\\b(?:${BARE_SAMSUNG_MODEL_RIVALS})\\b`,
    'i'
  );
  for (const sentence of content.split(/[.!?]+/)) {
    const tokenPattern = new RegExp(`\\b${letter}[0-9]{2}\\b`, 'gi');
    for (const match of sentence.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      if (
        letter === 'A' &&
        /^\s+(?:Pro|Bionic|chip)\b/i.test(
          sentence.slice(index + match[0].length)
        )
      ) {
        continue;
      }
      const before = sentence.slice(0, index);
      if (rivalPattern.test(before)) {
        continue;
      }
      if (/\b(?:Samsung|Galaxy)\b/i.test(before)) {
        return true;
      }
      // Samsung context after the token only counts when no rival brand
      // appears anywhere in the sentence (e.g. "A55 vs A34: Which
      // Samsung Mid-Ranger Wins?").
      if (
        !rivalPattern.test(sentence) &&
        /\b(?:Samsung|Galaxy)\b/i.test(sentence)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function matchesContent(
  entry: ModelFamilyAuthorityEntry,
  content: string
): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  if (entry.embeddedPatterns && entry.embeddedPatterns.length > 0) {
    // Bound the scan; model mentions live toward the front of post text.
    const bounded = trimmed.slice(0, 1000);
    if (entry.embeddedPatterns.some((pattern) => pattern.test(bounded))) {
      return true;
    }
    if (
      entry.brandKey === 'samsung' &&
      (entry.familyKey === 'galaxy-a' || entry.familyKey === 'galaxy-s')
    ) {
      return matchesBareSamsungModel(
        bounded,
        entry.familyKey === 'galaxy-a' ? 'A' : 'S'
      );
    }
    return false;
  }
  return matchesProduct(entry, trimmed);
}
