import type { CartSnapshot } from '@baci/shared/cart';
import { planNativeLegacyMerge } from './legacy-merge';

const product = '77777777-7777-4777-8777-777777777777';
const saved = {
  lines: [
    {
      id: 'line',
      item: { productId: product },
      quantity: 2,
      unitPriceMinor: 100,
      lineTotalMinor: 200,
    },
  ],
} as CartSnapshot;
const legacy = {
  id: 'old',
  product_id: product,
  name: 'Phone',
  slug: 'phone',
  price: 1,
  quantity: 1,
};
it('merges overlapping identities once using the shared max-quantity rule', () => {
  const result = planNativeLegacyMerge(saved, [legacy]);
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.lines).toEqual([
      { item: { productId: product }, quantity: 2 },
    ]);
});
it('preserves attachment conflicts for explicit resolution instead of dropping them', () => {
  const result = planNativeLegacyMerge(saved, [
    { ...legacy, negotiatedPrice: 0.5, negotiationStatus: 'accepted' },
  ]);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('merge_conflict');
});
