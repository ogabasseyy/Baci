/** A single unqualified word must appear as a whole word in product text.
 * field. This prevents substring matches such as "work" in "DreamWorks" from
 * being presented as product advice. Other queries keep the ranked search. */
export function singleWordDiscoveryTerm(query: string | undefined): string | undefined {
  return query?.match(/^\s*([a-z]{3,})[?!.,]*\s*$/i)?.[1]?.toLocaleLowerCase('en');
}

export function matchesSingleWordDiscoveryQuery(
  product: { name?: string | null; brand?: string | null; category?: string | null; description?: string | null },
  query: string | undefined,
  category: string | undefined
): boolean {
  const term = singleWordDiscoveryTerm(query);
  if (!term || category) return true;
  const words = [product.name, product.brand, product.category, product.description]
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.toLocaleLowerCase('en').match(/[a-z0-9]+/g) ?? []);
  return words.some((word) => word === term || word === `${term}s` || `${word}s` === term);
}
