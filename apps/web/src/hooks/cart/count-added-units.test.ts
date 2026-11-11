import { describe, expect, it } from 'vitest';
import type { CartItem } from './cart-types';
import { countAddedUnits } from './count-added-units';

const line = (id: string, quantity: number) =>
  ({ id, cartItemId: id, quantity }) as CartItem;

describe('countAddedUnits', () => {
  it('counts a fresh line', () => {
    expect(countAddedUnits([line('a', 1)], [line('a', 1), line('b', 3)])).toBe(
      3
    );
  });

  it('counts only the units a capped merge added', () => {
    expect(countAddedUnits([line('a', 3)], [line('a', 5)])).toBe(2);
  });

  it('never returns a negative count', () => {
    expect(countAddedUnits([line('a', 3)], [])).toBe(0);
  });
});
