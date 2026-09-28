/** A single unqualified word must appear as a whole word in an identifying
 * field. This prevents substring matches such as "work" in "DreamWorks" from
 * being presented as product advice. Other queries keep the ranked search. */
export function matchesSingleWordDiscoveryQuery(
  product: { name?: string | null; brand?: string | null; category?: string | null },
  query: string | undefined,
  category: string | undefined
): boolean {
  if (!query || category || !/^[a-z]{3,}$/i.test(query)) return true;
  const term = query.toLocaleLowerCase('en');
  const words = [product.name, product.brand, product.category]
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.toLocaleLowerCase('en').match(/[a-z0-9]+/g) ?? []);
  return words.some((word) => word === term || word === `${term}s` || `${word}s` === term);
}
