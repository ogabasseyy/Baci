import { expect, it, vi } from 'vitest';
import { recoverCartAdd, recoverExpiredAdd } from './recover-expired-add';

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
  expect(result.result).toEqual(success(fresh, [product.id, second.id]));
  expect(result.skippedSurvivors).toEqual([]);
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
  ).resolves.toEqual({ result: expired, skippedSurvivors: [] });
  expect(callTool).toHaveBeenCalledTimes(1);
});

it('rejects when a replay fails generically instead of dropping the line', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id]))
    .mockResolvedValueOnce({ structuredContent: { success: false } });
  await expect(
    recoverExpiredAdd(callTool, product.id, 1, [
      { product: second, quantity: 1 },
    ])
  ).rejects.toThrow(/did not complete/);
  expect(callTool).toHaveBeenCalledTimes(2);
});

it('skips unavailable survivors and resolves with the last good replay', async () => {
  const dead = {
    structuredContent: {
      success: false,
      product_unavailable: true,
      product_id: second.id,
    },
  };
  const third = { ...second, id: '33333333-3333-4333-8333-333333333333' };
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id]))
    .mockResolvedValueOnce(dead)
    .mockResolvedValueOnce(success(fresh, [product.id, third.id]));
  const result = await recoverExpiredAdd(callTool, product.id, 1, [
    { product: second, quantity: 1 },
    { product: third, quantity: 1 },
  ]);
  expect(result.result).toEqual(success(fresh, [product.id, third.id]));
  // The authoritative merge drops the skipped line from widget state, so
  // the skip must be reported for the removal notice — never silent.
  expect(result.skippedSurvivors).toEqual([
    { productId: second.id, requiresVariantSelection: false },
  ]);
  expect(callTool).toHaveBeenCalledTimes(3);
});

it('skips stale survivors and resolves with the last good replay', async () => {
  const stale = {
    structuredContent: {
      success: false,
      requires_variant_selection: true,
      product_id: second.id,
      product_url: 'https://ogabassey.com/products/camera',
    },
  };
  const third = { ...second, id: '33333333-3333-4333-8333-333333333333' };
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id]))
    .mockResolvedValueOnce(stale)
    .mockResolvedValueOnce(success(fresh, [product.id, third.id]));
  const result = await recoverExpiredAdd(callTool, product.id, 1, [
    { product: second, quantity: 1 },
    { product: third, quantity: 1 },
  ]);
  expect(result.result).toEqual(success(fresh, [product.id, third.id]));
  expect(result.skippedSurvivors).toEqual([
    { productId: second.id, requiresVariantSelection: true },
  ]);
  expect(callTool).toHaveBeenCalledTimes(3);
});

it('rejects when the fresh cart re-expires mid-replay', async () => {
  const reexpired = {
    structuredContent: { success: false, cart_expired: true },
  };
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id]))
    .mockResolvedValueOnce(reexpired);
  await expect(
    recoverExpiredAdd(callTool, product.id, 1, [
      { product: second, quantity: 1 },
    ])
  ).rejects.toThrow(/did not complete/);
  expect(callTool).toHaveBeenCalledTimes(2);
});

it('rejects on transport failure instead of merging a partial cart', async () => {
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id]))
    .mockRejectedValueOnce(new Error('offline'));
  await expect(
    recoverExpiredAdd(callTool, product.id, 1, [
      { product: second, quantity: 1 },
    ])
  ).rejects.toThrow(/did not complete/);
  expect(callTool).toHaveBeenCalledTimes(2);
});

it('replays local survivors into a tokenless mint', async () => {
  const minted = success(fresh, [product.id]);
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id, second.id]));
  const result = await recoverCartAdd(
    callTool,
    minted,
    product.id,
    1,
    undefined,
    [{ product, quantity: 1 }, { product: second, quantity: 2 }]
  );
  expect(result.result).toEqual(success(fresh, [product.id, second.id]));
  expect(result.skippedSurvivors).toEqual([]);
  expect(callTool).toHaveBeenCalledTimes(1);
  expect(callTool).toHaveBeenCalledWith({
    product_id: second.id,
    quantity: 2,
    cart_token: fresh,
  });
});

it('passes tokenless quota and failure responses through untouched', async () => {
  const denied = {
    structuredContent: {
      success: false,
      quota_exceeded: true,
      retry_after_seconds: 60,
    },
  };
  const failed = { structuredContent: { success: false } };
  const callTool = vi.fn();
  await expect(
    recoverCartAdd(callTool, denied, product.id, 1, undefined, [
      { product: second, quantity: 1 },
    ])
  ).resolves.toEqual({ result: denied, skippedSurvivors: [] });
  await expect(
    recoverCartAdd(callTool, failed, product.id, 1, undefined, [
      { product: second, quantity: 1 },
    ])
  ).resolves.toEqual({ result: failed, skippedSurvivors: [] });
  expect(callTool).not.toHaveBeenCalled();
});

it('passes a live token result through without replaying', async () => {
  const token = 'a'.repeat(64);
  const current = success(token, [product.id]);
  const callTool = vi.fn();
  await expect(
    recoverCartAdd(callTool, current, product.id, 1, token, [
      { product, quantity: 1 },
      { product: second, quantity: 1 },
    ])
  ).resolves.toEqual({ result: current, skippedSurvivors: [] });
  expect(callTool).not.toHaveBeenCalled();
});

function survivorAt(index: number) {
  return {
    product: { ...product, id: `33333333-3333-4333-8333-${index.toString(16).padStart(12, '0')}` },
    quantity: 1,
  };
}

it('refuses a full local cart before minting instead of orphaning one', async () => {
  const token = 'a'.repeat(64);
  const expired = { structuredContent: { success: false, cart_expired: true } };
  const callTool = vi.fn();
  const survivors = Array.from({ length: 20 }, (_, index) =>
    survivorAt(index)
  );
  await expect(
    recoverCartAdd(callTool, expired, product.id, 1, token, [
      { product, quantity: 1 },
      ...survivors,
    ])
  ).resolves.toEqual({
    result: { structuredContent: { success: false, cart_full: true } },
    skippedSurvivors: [],
  });
  // No retry mint: every mint here would orphan a partial cart and burn a
  // creation-quota slot while the shopper only needs to remove a line.
  expect(callTool).not.toHaveBeenCalled();
});

it('refuses a full tokenless cart without replaying', async () => {
  const minted = success(fresh, [product.id]);
  const callTool = vi.fn();
  const survivors = Array.from({ length: 20 }, (_, index) =>
    survivorAt(index)
  );
  await expect(
    recoverCartAdd(callTool, minted, product.id, 1, undefined, [
      { product, quantity: 1 },
      ...survivors,
    ])
  ).resolves.toEqual({
    result: { structuredContent: { success: false, cart_full: true } },
    skippedSurvivors: [],
  });
  expect(callTool).not.toHaveBeenCalled();
});

it('recovers a cart with one free slot', async () => {
  const token = 'a'.repeat(64);
  const expired = { structuredContent: { success: false, cart_expired: true } };
  const survivors = Array.from({ length: 19 }, (_, index) =>
    survivorAt(index)
  );
  const ids = [product.id, ...survivors.map((item) => item.product.id)];
  const callTool = vi.fn();
  for (let filled = 1; filled <= ids.length; filled += 1) {
    callTool.mockResolvedValueOnce(success(fresh, ids.slice(0, filled)));
  }
  const result = await recoverCartAdd(callTool, expired, product.id, 1, token, [
    { product, quantity: 1 },
    ...survivors,
  ]);
  expect(result.result).toEqual(success(fresh, ids));
  expect(result.skippedSurvivors).toEqual([]);
  expect(callTool).toHaveBeenCalledTimes(20);
});
