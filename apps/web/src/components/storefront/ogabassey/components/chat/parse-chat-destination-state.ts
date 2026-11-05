import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';

function normalizeWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

export function parseDestinationState(value: string):
  | { kind: 'matched'; stateName: string }
  | { kind: 'missing' | 'negated-state' | 'multiple-states' | 'ambiguous-niger' } {
  const words = normalizeWords(value);
  const subdivisions = getSubdivisions('NG');
  const matches: string[] = [];
  let hasNegatedState = false;
  let ambiguousNiger = false;
  for (const subdivision of subdivisions) {
    const terms = [subdivision.name, ...(subdivision.aliases ?? [])];
    for (const term of terms) {
      const termWords = normalizeWords(term);
      for (let start = 0; start <= words.length - termWords.length; start += 1) {
        if (!termWords.every((word, offset) => words[start + offset] === word)) continue;
        const end = start + termWords.length;
        const preceding = words.slice(Math.max(0, start - 8), start).join(' ');
        const following = words.slice(end, end + 8).join(' ');
        const precedingNegation = /\b(?:not|never|avoid|except|excluding|instead|rather)\b|\b(?:don t|doesn t|isn t|wasn t)\b/.test(preceding);
        const followingNegation = /\b(?:not|never|isn t|is not|wasn t|was not|not my destination|not the destination)\b/.test(following);
        // “No. 12 Lagos Street” is an address number, not a negated state.
        const noIsStreetNumber = /\bno\.?\s*\d+\b/i.test(value.slice(0, value.toLowerCase().indexOf(term.toLowerCase())));
        const precedingNo = /\bno\s*$/.test(preceding) && !noIsStreetNumber;
        if (precedingNegation || followingNegation || precedingNo) hasNegatedState = true;
        if (subdivision.code === 'NG-NI') {
          const explicitlyQualified = words[end] === 'state' ||
            (words[start - 2] === 'state' && words[start - 1] === 'of');
          if (!explicitlyQualified) ambiguousNiger = true;
        }
        matches.push(subdivision.name);
      }
    }
  }
  const uniqueMatches = [...new Set(matches)];
  if (hasNegatedState) return { kind: 'negated-state' };
  if (uniqueMatches.length > 1) return { kind: 'multiple-states' };
  if (ambiguousNiger) return { kind: 'ambiguous-niger' };
  if (uniqueMatches.length === 0) return { kind: 'missing' };
  return { kind: 'matched', stateName: uniqueMatches[0] };
}
