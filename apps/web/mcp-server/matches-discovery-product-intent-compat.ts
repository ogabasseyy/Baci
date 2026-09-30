import {
  detailBoundary,
  deviceQualifierAliases,
  knownBrandWords,
  knownDeviceFamilyWords,
  modelQualifiers,
} from './matches-discovery-product-intent-vocab';
import { matchesWord } from './matches-discovery-product-intent-word-match';

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
    if (introducers.has(coreWords[index] ?? '') || (index === 0 && coreWords[index] === 'with')) {
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
    .filter((word) => !['a', 'an', 'the'].includes(word));
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
  // Model-only targets ("S24" in "case for S24") carry no brand or family
  // word but still identify the device, so they activate their branch.
  const active = branches.filter((branch) =>
    branch.some((term) =>
      deviceQualifierAliases.has(term) || knownBrandWords.has(term) || knownDeviceFamilyWords.has(term) || /\d/.test(term)));
  const span = active.length > 0 ? { end: spanEnd, start } : { end: 0, start: 0 };
  // A target branch matches when its terms appear in order, tolerating
  // recognized family words ("Galaxy") between the brand and the model.
  const matchesTargetBranch = (text: string[], target: string[]): boolean =>
    text.some((_, start) => {
      if (!matchesWord([text[start] ?? ''], target[0] ?? '')) return false;
      let position = start + 1;
      for (const term of target.slice(1)) {
        while (position < text.length && knownDeviceFamilyWords.has(text[position] ?? '') &&
          !matchesWord([text[position] ?? ''], term)) position += 1;
        if (!matchesWord([text[position] ?? ''], term)) return false;
        position += 1;
      }
      if (target.some((term) => /\d/.test(term))) {
        const requestedQualifiers = target.filter((term) => modelQualifiers.has(term));
        for (let next = position; modelQualifiers.has(text[next] ?? ''); next += 1) {
          if (!requestedQualifiers.includes(text[next] ?? '')) return false;
        }
      }
      return true;
    });
  const matched = active.length === 0 || active.some((branch) => {
    const genericDevices = branch.filter((word) => deviceQualifierAliases.has(word));
    for (const device of genericDevices) {
      const aliases = deviceQualifierAliases.get(device) ?? [];
      const requested = aliases.some((alias) => matchesWord(compatibilityWords, alias));
      const conflicting = [...deviceQualifierAliases.values()].some((other) =>
        !aliases.some((alias) => other.includes(alias)) &&
        other.some((alias) => matchesWord(compatibilityWords, alias)));
      if (conflicting && !requested) return false;
    }
    const identityTarget = branch.filter((word) => !deviceQualifierAliases.has(word));
    if (identityTarget.length > 0 && !matchesTargetBranch(compatibilityWords, identityTarget)) return false;
    return true;
  });
  return { ...span, matched };
}
