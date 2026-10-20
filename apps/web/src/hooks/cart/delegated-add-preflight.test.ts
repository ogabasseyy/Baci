import { expect, it } from 'vitest';
import type { SharedCartDisplayItem } from './cart-types';
import { planDelegatedAddQuantity } from './delegated-add-preflight';

function line(overrides: Record<string, unknown> = {}): SharedCartDisplayItem {
  return {
    brand: '',
    cartItemId: 'a',
    description: '',
    gtin: '',
    id: 'p',
    image: '',
    imageHint: '',
    imageLarge: '',
    manage_stock: false,
    mpn: '',
    name: 'Phone',
    price: 100,
    quantity: 1,
    status: 'active',
    stock: 10,
    ...overrides,
  } as SharedCartDisplayItem;
}

const product = { id: 'p', manage_stock: false, stock: 10 } as never;

it('rejects an ordinary line already at the cap', () => {
  expect(planDelegatedAddQuantity([line({ quantity: 10 })], product, 1)).toBe(
    0
  );
});

it('counts a negotiated line toward the cap only when the void converts it', () => {
  const negotiated = line({ quantity: 10, negotiatedPrice: 90 });
  expect(planDelegatedAddQuantity([negotiated], product, 1)).toBe(1);
  expect(
    planDelegatedAddQuantity([negotiated], product, 1, undefined, true)
  ).toBe(0);
});

it('clamps to the post-void headroom for partial remaining capacity', () => {
  const negotiated = line({ quantity: 9, negotiatedPrice: 90 });
  expect(
    planDelegatedAddQuantity([negotiated], product, 2, undefined, true)
  ).toBe(1);
  expect(planDelegatedAddQuantity([line({ quantity: 9 })], product, 2)).toBe(1);
  expect(planDelegatedAddQuantity([], product, 3)).toBe(3);
});

it('rejects out-of-stock and variant-blocked adds', () => {
  expect(
    planDelegatedAddQuantity(
      [],
      { id: 'p', manage_stock: true, stock: 0 } as never,
      1
    )
  ).toBe(0);
  expect(
    planDelegatedAddQuantity([], product, 1, { variantRequired: 'yes' })
  ).toBe(0);
});
