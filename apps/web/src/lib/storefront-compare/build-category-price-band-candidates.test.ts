import { describe, expect, it } from 'vitest';
import { buildCategoryPriceBandCandidates } from './build-category-price-band-candidates';

const product = (slug: string, brand: string, price: number) => ({
  slug,
  name: slug,
  brand,
  price,
});

describe('buildCategoryPriceBandCandidates', () => {
  it('builds one candidate per curated band with band-scoped products', () => {
    const candidates = buildCategoryPriceBandCandidates('smartphones', [
      product('a1', 'Apple', 400_000),
      product('a2', 'Apple', 450_000),
      product('s1', 'Samsung', 480_000),
      product('x1', 'Xiaomi', 300_000),
      product('t1', 'Tecno', 200_000),
      product('i1', 'Infinix', 150_000),
      product('flagship', 'Apple', 1_500_000),
    ]);

    expect(candidates.map((candidate) => candidate.band.slug)).toEqual([
      'under-500k',
      'under-1m',
    ]);
    const under500k = candidates[0];
    expect(under500k?.activeProductCount).toBe(6);
    expect(under500k?.products.map((entry) => entry.slug)).not.toContain(
      'flagship'
    );
    expect(under500k?.isIndexable).toBe(true);
  });

  it('returns no candidates for an uncurated category', () => {
    expect(buildCategoryPriceBandCandidates('furniture', [])).toEqual([]);
  });
});
