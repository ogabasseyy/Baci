import { expect, it } from 'vitest';
import { criteriaSchema } from './search-refinement-criteria-schema';

it('pins the price-range message and path', () => {
  const parsed = criteriaSchema.safeParse({
    brands: [],
    sort: 'relevance',
    minPrice: 30,
    maxPrice: 20,
  });
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error('Expected a range failure');
  expect(parsed.error.issues).toEqual([
    expect.objectContaining({
      message: 'Minimum price must not exceed maximum price',
      path: ['maxPrice'],
    }),
  ]);
});
