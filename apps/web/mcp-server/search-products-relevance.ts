/** A single unqualified word must appear as a whole word in product text.
 * field. This prevents substring matches such as "work" in "DreamWorks" from
 * being presented as product advice. Other queries keep the ranked search. */
export function singleWordDiscoveryTerm(query: string | undefined): string | undefined {
  const words = query?.normalize('NFKC').toLocaleLowerCase('en').match(/[a-z0-9]+/g);
  return words?.length === 1 && /^[a-z]{3,}$/.test(words[0]) ? words[0] : undefined;
}

export function isBroadUseCaseQuery(query: string | undefined): boolean {
  return /^(?:(?:something|anything|products?|items?|gadgets?|best|recommendations?)\s+)?(?:for|to help with)\s+[a-z ]+$/i.test(query?.trim() ?? '');
}

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
