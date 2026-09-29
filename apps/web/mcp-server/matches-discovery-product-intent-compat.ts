import {
  detailBoundary,
  knownBrandWords,
  knownDeviceFamilyWords,
  modelQualifiers,
} from './matches-discovery-product-intent-vocab';
import {
  hasConsecutiveWords,
  matchesWord,
} from './matches-discovery-product-intent-words';

/** Validate "for", "compatible with", and "fits" device targets. Brands after
 * the introducer describe compatibility rather than the manufacturer, and
 * "or" branches ("for iPhone or Samsung") match independently. The returned
 * span covers an active clause so feature checks skip its target words. */
export function matchesCompatibilityClause({ compatibilityWords, coreWords, itemWords }: {
  compatibilityWords: string[];
  coreWords: string[];
  itemWords: string[];
}): { end: number; matched: boolean; start: number } {
  const introducers = new Set(['for', 'compatible', 'fits']);
  let introducerIndex = -1;
  for (let index = itemWords.length; index < coreWords.length; index += 1) {
    if (introducers.has(coreWords[index] ?? '')) {
      introducerIndex = index;
      break;
    }
  }
  if (introducerIndex < 0) return { end: 0, matched: true, start: 0 };
  let start = introducerIndex + 1;
  if (coreWords[introducerIndex] === 'compatible' && coreWords[start] === 'with') start += 1;
  const end = coreWords.findIndex((word, index) => index >= start && detailBoundary.has(word));
  const spanEnd = end < 0 ? coreWords.length : end;
  const terms = coreWords.slice(start, spanEnd)
    .filter((word) => !['a', 'an', 'the', 'phone', 'phones', 'device', 'devices'].includes(word));
  const branches: string[][] = [];
  let current: string[] = [];
  for (const word of terms) {
    if (word === 'or') {
      if (current.length > 0) branches.push(current);
      current = [];
    } else {
      current.push(word);
    }
  }
  if (current.length > 0) branches.push(current);
  const active = branches.filter((branch) =>
    branch.some((term) => knownBrandWords.has(term) || knownDeviceFamilyWords.has(term)));
  const span = active.length > 0 ? { end: spanEnd, start } : { end: 0, start: 0 };
  const matched = active.length === 0 || active.some((branch) => {
    if (!hasConsecutiveWords(compatibilityWords, branch)) return false;
    const anchor = branch.findIndex((word) => /\d/.test(word));
    if (anchor < 0) return true;
    const productAnchor = compatibilityWords.findIndex((word, index) =>
      matchesWord([word], branch[anchor] ?? '') &&
      hasConsecutiveWords(compatibilityWords.slice(index), branch.slice(anchor)));
    if (productAnchor < 0) return true;
    const queryQualifiers = branch.slice(anchor + 1).filter((word) => modelQualifiers.has(word));
    const productQualifiers: string[] = [];
    for (let next = productAnchor + 1; modelQualifiers.has(compatibilityWords[next] ?? ''); next += 1) {
      productQualifiers.push(compatibilityWords[next] ?? '');
    }
    return !productQualifiers.some((qualifier) => !queryQualifiers.includes(qualifier));
  });
  return { ...span, matched };
}
