import { availableSearchFacetsSchema } from './available-search-facets';

const facets = {
  brands: ['Apple'],
  categories: [{ id: 'phones', name: 'Phones' }],
  conditions: ['used'],
  minPrice: 0,
  maxPrice: null,
};
it('accepts query facets with optional processors and nullable bounds', () => {
  expect(availableSearchFacetsSchema.safeParse(facets).success).toBe(true);
  expect(
    availableSearchFacetsSchema.safeParse({ ...facets, processors: ['M3'] })
      .success
  ).toBe(true);
});
it.each([
  { ...facets, conditions: ['refurbished'] },
  { ...facets, minPrice: -1 },
  { ...facets, maxPrice: Number.POSITIVE_INFINITY },
  { ...facets, categories: [{ id: 'phones' }] },
  { ...facets, brands: [42] },
])('rejects malformed facet payloads %#', (input) => {
  expect(availableSearchFacetsSchema.safeParse(input).success).toBe(false);
});
