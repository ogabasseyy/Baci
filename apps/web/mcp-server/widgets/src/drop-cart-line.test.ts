import { expect, it } from 'vitest';
import { dropLineFromCartState } from './drop-cart-line';

const product = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Phone',
  slug: 'phone',
  price: 90000,
};
const second = {
  ...product,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Camera',
};

it('drops the line and rebuilds the handoff URL from survivors', () => {
  const next = dropLineFromCartState(
    {
      cart: [
        { product, quantity: 2 },
        { product: second, quantity: 1 },
      ],
      cartUrl: 'https://ogabassey.com/cart?item_id=legacy&qty=1',
      cartToken: 'a'.repeat(64),
    },
    product.id
  );
  expect(next.cart).toEqual([{ product: second, quantity: 1 }]);
  expect(next.cartToken).toBeUndefined();
  const url = new URL(next.cartUrl ?? '');
  expect(JSON.parse(url.searchParams.get('guest_cart') ?? 'null')).toEqual([
    { product_id: second.id, quantity: 1 },
  ]);
});

it('clears the handoff URL when no lines survive', () => {
  const next = dropLineFromCartState(
    { cart: [{ product, quantity: 1 }] },
    product.id
  );
  expect(next.cart).toEqual([]);
  expect(next.cartUrl).toBeUndefined();
  expect(next.cartToken).toBeUndefined();
});
