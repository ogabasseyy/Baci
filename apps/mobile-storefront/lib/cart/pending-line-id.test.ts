import type { CartItem } from '@/stores/cart-store.types';
import {
  isPendingLineId,
  pendingLineId,
  stripPendingLines,
  withoutPendingLines,
} from './pending-line-id';

const line = (id: string): CartItem => ({
  id,
  product_id: 'p',
  slug: 'p',
  name: 'P',
  price: 1,
  quantity: 1,
});

it('recognises ids it minted and nothing else', () => {
  expect(isPendingLineId(pendingLineId(3))).toBe(true);
  expect(isPendingLineId('line-1')).toBe(false);
});

it('strips predicted lines and keeps the same array when there are none', () => {
  const clean = [line('a')];
  expect(stripPendingLines(clean)).toBe(clean);
  expect(
    stripPendingLines([line(pendingLineId(1)), line('a')]).map((i) => i.id)
  ).toEqual(['a']);
});

it('hides predicted lines from a wrapped legacy reader', () => {
  const read = withoutPendingLines(() => ({
    items: [line(pendingLineId(1)), line('a')],
    extra: 1,
  }));
  expect(read().items.map((i) => i.id)).toEqual(['a']);
  expect(read().extra).toBe(1);
});
