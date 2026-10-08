import { expect, it, vi } from 'vitest';
import { recoverExpiredAdd } from './recover-expired-add';

const fresh = 'b'.repeat(64);
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

function success(cartToken: string, ids: string[]) {
  const url = new URL('https://ogabassey.com/cart');
  url.searchParams.set(
    'guest_cart',
    JSON.stringify(ids.map((product_id) => ({ product_id, quantity: 1 })))
  );
  return {
    structuredContent: {
      success: true,
      cart_url: url.toString(),
      cart_token: cartToken,
    },
  };
}

it('retries without the token and replays survivors into the fresh cart', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id]))
    .mockResolvedValueOnce(success(fresh, [product.id, second.id]));
  const result = await recoverExpiredAdd(callTool, product.id, 1, [
    { product: second, quantity: 1 },
  ]);
  expect(result).toEqual(success(fresh, [product.id, second.id]));
  expect(callTool).toHaveBeenNthCalledWith(1, {
    product_id: product.id,
    quantity: 1,
    cart_token: undefined,
  });
  expect(callTool).toHaveBeenNthCalledWith(2, {
    product_id: second.id,
    quantity: 1,
    cart_token: fresh,
  });
});

it('returns the retry result untouched when it fails or selects variants', async () => {
  const expired = { structuredContent: { success: false, cart_expired: true } };
  const callTool = vi.fn().mockResolvedValue(expired);
  await expect(
    recoverExpiredAdd(callTool, product.id, 1, [
      { product: second, quantity: 1 },
    ])
  ).resolves.toBe(expired);
  expect(callTool).toHaveBeenCalledTimes(1);
});

it('skips stale survivors and stops when the fresh cart re-expires', async () => {
  const stale = { structuredContent: { success: false } };
  const reexpired = {
    structuredContent: { success: false, cart_expired: true },
  };
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id]))
    .mockResolvedValueOnce(stale)
    .mockResolvedValueOnce(reexpired);
  const third = { ...second, id: '33333333-3333-4333-8333-333333333333' };
  const result = await recoverExpiredAdd(callTool, product.id, 1, [
    { product: second, quantity: 1 },
    { product: third, quantity: 1 },
  ]);
  expect(result).toEqual(success(fresh, [product.id]));
  expect(callTool).toHaveBeenCalledTimes(3);
});

it('stops replaying on transport failure and keeps the last good result', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id]))
    .mockRejectedValueOnce(new Error('offline'));
  const result = await recoverExpiredAdd(callTool, product.id, 1, [
    { product: second, quantity: 1 },
  ]);
  expect(result).toEqual(success(fresh, [product.id]));
  expect(callTool).toHaveBeenCalledTimes(2);
});
