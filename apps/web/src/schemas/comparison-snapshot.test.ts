import { expect, it } from 'vitest';
import { comparisonSnapshotSchema } from './comparison-snapshot';

const snapshot = {
  id: 'p1',
  name: 'Phone',
  price: '$100',
  image: '/phone.jpg',
  description: '',
};
it('keeps safe fallback fields and drops unvalidated fields', () => {
  expect(
    comparisonSnapshotSchema.parse({
      ...snapshot,
      slug: 'phone',
      variants: [{}],
    })
  ).toEqual({ ...snapshot, slug: 'phone' });
});
it.each([
  { id: 'p1' },
  { ...snapshot, name: undefined },
  { ...snapshot, name: 42 },
  { ...snapshot, slug: {} },
  { ...snapshot, categories: { name: 42 } },
  { ...snapshot, id: Number.POSITIVE_INFINITY },
  { ...snapshot, rawPrice: -1 },
])('rejects unsafe fallback snapshots %#', (input) => {
  expect(comparisonSnapshotSchema.safeParse(input).success).toBe(false);
});
