import { expect, it, vi } from 'vitest';
import { loadUcpCartSession } from './ucp-cart-session-read';

vi.mock('./ucp-cart-route-support', () => {
  throw new Error('Reader must not load route bootstrap authority');
});
function client(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  const from = vi.fn(() => query);
  return { from, query };
}
it('reads the exact merchant/cart using only the provided client and normalizes migration metadata', async () => {
  const supplied = client({
    data: {
      cart_id: 'legacy',
      merchant_id: 'merchant',
      migrated_to_cart_id: 'canonical',
    },
    error: null,
  });
  const result = await loadUcpCartSession({
    cartId: 'legacy',
    merchantId: 'merchant',
    supabase: supplied as never,
  });
  expect(supplied.from).toHaveBeenCalledWith('agentic_cart_sessions');
  expect(supplied.query.eq.mock.calls).toEqual([
    ['cart_id', 'legacy'],
    ['merchant_id', 'merchant'],
  ]);
  expect(result).toMatchObject({
    error: null,
    cart: { migratedToCartId: 'canonical' },
  });
});
it.each([
  { data: null, error: null },
  { data: { cart_id: 'legacy' }, error: { message: 'unavailable' } },
])('preserves missing rows and database failures without constructing another client', async (outcome) => {
  const supplied = client(outcome);
  expect(
    await loadUcpCartSession({
      cartId: 'legacy',
      merchantId: 'merchant',
      supabase: supplied as never,
    })
  ).toEqual({ cart: null, error: outcome.error });
  expect(supplied.from).toHaveBeenCalledOnce();
});
