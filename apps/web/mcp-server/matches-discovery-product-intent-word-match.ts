import {
  equivalentTerms,
  irregularPlurals,
  irregularSingulars,
} from './matches-discovery-product-intent-vocab';

export function matchesWord(textWords: string[], term: string): boolean {
  // Known singulars keep their trailing "s" ("lens" is not "len" + "s").
  const singular = irregularSingulars.has(term)
    ? term
    : irregularPlurals.get(term) ?? (term.endsWith('ies')
      ? `${term.slice(0, -3)}y`
      : term.replace(/s$/, ''));
  const plural = irregularSingulars.get(singular) ?? `${singular}s`;
  const equivalents = equivalentTerms.get(term) ?? [];
  return textWords.some((word) =>
    word === term || word === singular || word === plural ||
    equivalents.includes(word) ||
    (singular === 'phone' && (word === 'smartphone' || word === 'smartphones')) ||
    (singular === 'earbud' && (word === 'bud' || word === 'buds'))
  );
}
