import { expect, it } from 'vitest';
import type { SharedCartDisplayItem } from './cart-types';
import { delegatedAddCanBeAccepted } from './delegated-add-preflight';

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
  expect(delegatedAddCanBeAccepted([line({ quantity: 10 })], product, 1)).toBe(
    false
  );
});

it('counts a negotiated line toward the cap only when the void converts it', () => {
  const negotiated = line({ quantity: 10, negotiatedPrice: 90 });
  expect(delegatedAddCanBeAccepted([negotiated], product, 1)).toBe(true);
  expect(
    delegatedAddCanBeAccepted([negotiated], product, 1, undefined, true)
  ).toBe(false);
});

it('rejects out-of-stock and variant-blocked adds', () => {
  expect(
    delegatedAddCanBeAccepted(
      [],
      { id: 'p', manage_stock: true, stock: 0 } as never,
      1
    )
  ).toBe(false);
  expect(
    delegatedAddCanBeAccepted([], product, 1, { variantRequired: 'yes' })
  ).toBe(false);
});
