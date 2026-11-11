import { describe, expect, it } from 'vitest';
import type { CartItem } from './cart-types';
import { countAddedUnits } from './count-added-units';

const line = (id: string, quantity: number, cartItemId = id) =>
  ({ id, cartItemId, quantity }) as CartItem;

describe('countAddedUnits', () => {
  it('counts a fresh line', () => {
    expect(
      countAddedUnits([line('a', 1)], [line('a', 1), line('b', 3)], 'b')
    ).toBe(3);
  });

  it('counts only the units a capped merge added', () => {
    expect(countAddedUnits([line('a', 3)], [line('a', 5)], 'a')).toBe(2);
  });

  it('ignores changes to other products in the same cart', () => {
    expect(
      countAddedUnits(
        [line('a', 1), line('gift', 1)],
        [line('a', 2), line('gift', 3)],
        'a'
      )
    ).toBe(1);
  });

  it('never returns a negative count', () => {
    expect(countAddedUnits([line('a', 3)], [], 'a')).toBe(0);
  });
});
