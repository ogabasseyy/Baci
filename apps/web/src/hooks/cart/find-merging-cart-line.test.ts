import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import type { CartItem } from './cart-types';
import { findMergingCartLineIndex } from './find-merging-cart-line';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    merchant_id: 'merchant-1',
    name: 'Phone',
    description: '',
    status: 'active',
    price: 450000,
    manage_stock: false,
    stock: 10,
    image: '',
    imageLarge: '',
    imageHint: '',
    brand: 'Brand',
    gtin: '',
    mpn: '',
    slug: 'phone',
    images: [],
    ...overrides,
  } as Product;
}

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    ...(makeProduct() as CartItem),
    cartItemId: 'p1',
    quantity: 1,
    ...overrides,
  };
}

/** Historical persisted lines predate `cartItemId`. */
function makeLegacyCartItem(overrides: Partial<CartItem> = {}): CartItem {
  const item = makeCartItem(overrides);
  delete (item as Partial<CartItem>).cartItemId;
  return item;
}

describe('findMergingCartLineIndex', () => {
  it('returns -1 when no line would merge', () => {
    expect(findMergingCartLineIndex([], makeProduct())).toBe(-1);
    expect(
      findMergingCartLineIndex(
        [makeCartItem({ id: 'other', cartItemId: 'other' })],
        makeProduct()
      )
    ).toBe(-1);
  });

  it('matches a modern line by cart item id', () => {
    const cart = [
      makeCartItem({ id: 'other', cartItemId: 'other' }),
      makeCartItem({ id: 'p1', cartItemId: 'p1' }),
    ];

    expect(findMergingCartLineIndex(cart, makeProduct())).toBe(1);
  });

  it('matches a legacy ID-only line without cartItemId', () => {
    const cart = [makeLegacyCartItem({ id: 'p1' })];

    expect(findMergingCartLineIndex(cart, makeProduct())).toBe(0);
  });

  it('does not match a variant line for an option-less add', () => {
    const cart = [
      makeCartItem({
        id: 'p1',
        cartItemId: 'p1::variant=v1',
        variantId: 'v1',
      }),
    ];

    expect(findMergingCartLineIndex(cart, makeProduct())).toBe(-1);
  });

  it('matches a variant line when the options carry its variant', () => {
    const cart = [
      makeCartItem({
        id: 'p1',
        cartItemId: 'p1::variant=v1',
        variantId: 'v1',
      }),
    ];

    expect(
      findMergingCartLineIndex(cart, makeProduct(), { variantId: 'v1' })
    ).toBe(0);
  });

  it('resolves the default variant for option-less adds of variant products', () => {
    const product = makeProduct({
      has_variants: true,
      variants: [
        {
          id: 'v1',
          product_id: 'p1',
          merchant_id: 'merchant-1',
          attributes: {},
          stock_quantity: 5,
        },
      ],
    });
    const cart = [
      makeCartItem({
        id: 'p1',
        cartItemId: 'p1::variant=v1',
        variantId: 'v1',
      }),
    ];

    expect(findMergingCartLineIndex(cart, product)).toBe(0);
  });
});
