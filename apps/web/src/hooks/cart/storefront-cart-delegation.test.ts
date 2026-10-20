import { describe, expect, it } from 'vitest';
import type { SharedCartDisplayItem } from './cart-types';
import {
  delegatedLineTarget,
  planGroupDealVoid,
} from './storefront-cart-delegation';

function line(
  overrides: Partial<SharedCartDisplayItem>
): SharedCartDisplayItem {
  return {
    cartItemId: 'line-1',
    id: 'product-1',
    name: 'Phone',
    price: 1000,
    quantity: 1,
    ...overrides,
  } as SharedCartDisplayItem;
}

describe('delegatedLineTarget', () => {
  it('prefers the exact cart line id over product identity', () => {
    const display = [
      line({ cartItemId: 'line-9', id: 'product-9' }),
      line({ cartItemId: 'line-1', id: 'product-1' }),
    ];
    expect(delegatedLineTarget(display, 'line-9')?.cartItemId).toBe('line-9');
  });

  it('falls back to product identity with variant matching', () => {
    const display = [
      line({ cartItemId: 'line-1', id: 'product-1', variantId: 'red' }),
      line({ cartItemId: 'line-2', id: 'product-1', variantId: 'blue' }),
      line({ cartItemId: 'line-3', id: 'product-1' }),
    ];
    expect(delegatedLineTarget(display, 'product-1', 'blue')?.cartItemId).toBe(
      'line-2'
    );
    // An undefined variant only matches the variantless line.
    expect(delegatedLineTarget(display, 'product-1')?.cartItemId).toBe(
      'line-3'
    );
    expect(delegatedLineTarget(display, 'missing')).toBeNull();
  });
});

describe('planGroupDealVoid', () => {
  it('plans reprices only for negotiated lines, sparing the edit target', () => {
    const display = [
      line({ cartItemId: 'line-1', negotiatedPrice: 800 }),
      line({ cartItemId: 'line-2', negotiationStatus: 'pending' }),
      line({ cartItemId: 'line-3' }),
    ];
    expect(
      planGroupDealVoid(display, 'line-2').map((entry) => entry.cartItemId)
    ).toEqual(['line-1']);
  });

  it('applies queued quantity overrides to re-added lines', () => {
    const display = [
      line({ cartItemId: 'line-1', negotiatedPrice: 800, quantity: 1 }),
    ];
    const [planned] = planGroupDealVoid(
      display,
      undefined,
      new Map([['line-1', 3]])
    );
    expect(planned?.quantity).toBe(3);
    expect(planned?.cartItemId).toBe('line-1');
  });
});
