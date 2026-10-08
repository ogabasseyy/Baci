import { describe, expect, it } from 'vitest';
import { availableSearchFacetsSchema } from './available-search-facets';

const valid = {
  brands: ['Apple'],
  processors: ['M3'],
  categories: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Phones' }],
  conditions: ['used' as const],
  minPrice: 100,
  maxPrice: 900000,
};

describe('availableSearchFacetsSchema', () => {
  it('accepts a complete facet payload with optional processors omitted', () => {
    expect(availableSearchFacetsSchema.safeParse(valid).success).toBe(true);
    expect(
      availableSearchFacetsSchema.safeParse({ ...valid, processors: undefined })
        .success
    ).toBe(true);
  });
  it('rejects unknown conditions and non-finite bounds', () => {
    expect(
      availableSearchFacetsSchema.safeParse({
        ...valid,
        conditions: ['refurbished'],
      }).success
    ).toBe(false);
    expect(
      availableSearchFacetsSchema.safeParse({
        ...valid,
        minPrice: Number.POSITIVE_INFINITY,
      }).success
    ).toBe(false);
    expect(
      availableSearchFacetsSchema.safeParse({ ...valid, maxPrice: -1 }).success
    ).toBe(false);
    expect(
      availableSearchFacetsSchema.safeParse({
        ...valid,
        categories: [{ id: 'phones' }],
      }).success
    ).toBe(false);
    expect(
      availableSearchFacetsSchema.safeParse({ ...valid, brands: [42] }).success
    ).toBe(false);
  });
});
