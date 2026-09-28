import { singleWordDiscoveryTerm } from './single-word-discovery-term';

/** A single unqualified word must appear as a whole word in product text.
 * This prevents substring matches such as "work" in "DreamWorks" from
 * being presented as product advice. Other queries keep the ranked search. */
export function matchesSingleWordDiscoveryQuery(
  product: { name?: string | null; brand?: string | null; category?: string | null; description?: string | null },
  query: string | undefined,
  category: string | undefined
): boolean {
  const term = singleWordDiscoveryTerm(query);
  if (!term || category) return true;
  const fields = [product.name, product.brand, product.category, product.description]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLocaleLowerCase('en').match(/[a-z0-9]+/g) ?? []);
  const words = fields.flat();
  const matchesTerm = (word: string) => word === term || word === `${term}s` || `${word}s` === term ||
    (term.endsWith('y') && word === `${term.slice(0, -1)}ies`) ||
    (word.endsWith('y') && term === `${word.slice(0, -1)}ies`);
  return words.some(matchesTerm) || fields.slice(0, 3).some((parts) => matchesTerm(parts.join('')));
}
