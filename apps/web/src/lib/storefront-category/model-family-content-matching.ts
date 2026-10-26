import type { ModelFamilyAuthorityEntry } from '@/lib/storefront-category/category-hub-types';

function matchesProduct(entry: ModelFamilyAuthorityEntry, productName: string) {
  const trimmed = productName.trim();
  if (entry.modelPatterns && entry.modelPatterns.length > 0) {
    return entry.modelPatterns.some((pattern) => pattern.test(trimmed));
  }
  return entry.productNamePattern.test(trimmed);
}

const RIVAL_BRAND_PATTERN =
  /\b(?:Apple|iPhone|Oppo|Redmi|Vivo|Tecno|Infinix|Itel|Xiaomi|Honor|Google|OnePlus)\b/i;
const SAMSUNG_BRAND_PATTERN = /\b(?:Samsung|Galaxy)\b/i;
const ANY_BRAND_PATTERN =
  /\b(?:Samsung|Galaxy|Apple|iPhone|Oppo|Redmi|Vivo|Tecno|Infinix|Itel|Xiaomi|Honor|Google|OnePlus)\b/gi;

function matchesBareSamsungModel(content: string, letter: 'A' | 'S'): boolean {
  for (const sentence of content.split(/[.!?]+/)) {
    const tokenPattern = letter === 'A' ? /\bA[0-9]{2}\b/gi : /\bS[0-9]{2}\b/gi;
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
      // The nearest brand mention before the token owns it: a rival
      // directly before disqualifies, Samsung/Galaxy before qualifies.
      const before = sentence.slice(0, index);
      let nearestBeforeIsSamsung: boolean | null = null;
      for (const brandMatch of before.matchAll(ANY_BRAND_PATTERN)) {
        nearestBeforeIsSamsung = SAMSUNG_BRAND_PATTERN.test(brandMatch[0]);
      }
      if (nearestBeforeIsSamsung === true) {
        return true;
      }
      if (nearestBeforeIsSamsung === false) {
        continue;
      }
      // No brand before the token: Samsung context elsewhere in the
      // sentence counts only when no rival brand appears at all (e.g.
      // "A55 vs A34: Which Samsung Mid-Ranger Wins?").
      if (
        !RIVAL_BRAND_PATTERN.test(sentence) &&
        /\b(?:Samsung|Galaxy)\b/i.test(sentence)
      ) {
        return true;
      }
    }
  }
  return false;
}

function matchesContent(
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

export const modelFamilyContentMatching = {
  matchesProduct,
  matchesContent,
};
