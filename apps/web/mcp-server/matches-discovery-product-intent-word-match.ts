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
  const plural = irregularSingulars.get(singular) ??
    (/[^aeiou]y$/.test(singular) ? `${singular.slice(0, -1)}ies` : `${singular}s`);
  const equivalents = equivalentTerms.get(term) ?? [];
  return textWords.some((word, index) =>
    word === term || word === singular || word === plural ||
    (term === 'usb' && word === 'usbc') ||
    (term === 'usbc' && word === 'usb' && textWords[index + 1] === 'c') ||
    equivalents.includes(word) ||
    (singular === 'phone' && (word === 'smartphone' || word === 'smartphones')) ||
    (singular === 'earbud' && (word === 'bud' || word === 'buds'))
  );
}
