import { expect, it } from 'vitest';
import type { CartItem } from './cart-types';
import { removeOxygenPurchasedLines } from './oxygen-cart-completion';

const line = (id: string, instance: string | undefined, quantity: number) =>
  ({
    id,
    name: id,
    price: 100,
    cartItemId: id,
    cartLineInstanceId: instance,
    quantity,
  }) as CartItem;
it('removes purchased lines while preserving new products and extra quantity on the same instance', () => {
  const cart = [
    line('a', 'instance-a', 3),
    line('b', 'instance-b', 1),
    line('new', 'instance-new', 1),
  ];
  expect(
    removeOxygenPurchasedLines(cart, [
      { cartItemId: 'a', instanceId: 'instance-a', quantity: 2 },
      { cartItemId: 'b', instanceId: 'instance-b', quantity: 1 },
    ]).map(({ cartItemId, quantity }) => ({ cartItemId, quantity }))
  ).toEqual([
    { cartItemId: 'a', quantity: 1 },
    { cartItemId: 'new', quantity: 1 },
  ]);
});
it('preserves removed and re-added identical products and legacy lines', () => {
  const cart = [line('a', 'new-instance', 1), line('b', undefined, 1)];
  expect(
    removeOxygenPurchasedLines(cart, [
      { cartItemId: 'a', instanceId: 'old-instance', quantity: 1 },
      { cartItemId: 'b', instanceId: 'old', quantity: 1 },
    ])
  ).toEqual(cart);
});
