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
it('retains brand and condition fallbacks for unrefreshed tray items', () => {
  expect(
    comparisonSnapshotSchema.parse({
      ...snapshot,
      brand: 'Acme',
      condition: 'used',
    })
  ).toEqual({ ...snapshot, brand: 'Acme', condition: 'used' });
  // Unknown stored conditions drop the field but keep the item.
  expect(
    comparisonSnapshotSchema.parse({ ...snapshot, condition: 'bogus' })
  ).toEqual({ ...snapshot, condition: undefined });
});
it('preserves the matched-option basis for off-page tray items', () => {
  expect(
    comparisonSnapshotSchema.parse({
      ...snapshot,
      matchVariantId: 'variant-blue-128',
      matchOfferId: 'offer-open-box',
      matchCondition: 'open_box',
    })
  ).toEqual({
    ...snapshot,
    matchVariantId: 'variant-blue-128',
    matchOfferId: 'offer-open-box',
    matchCondition: 'open_box',
  });
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
