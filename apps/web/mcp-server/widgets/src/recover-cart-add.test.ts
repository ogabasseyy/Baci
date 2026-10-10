import { expect, it, vi } from 'vitest';
import { recoverCartAdd } from './recover-expired-add';

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

function survivorAt(index: number) {
  return {
    product: { ...product, id: `33333333-3333-4333-8333-${index.toString(16).padStart(12, '0')}` },
    quantity: 1,
  };
}

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

it('retires the partial mint when replay aborts instead of orphaning it', async () => {
  const minted = success(fresh, [product.id]);
  const third = survivorAt(2).product;
  const callTool = vi
    .fn()
    .mockResolvedValueOnce(success(fresh, [product.id, second.id]))
    .mockRejectedValueOnce(new Error('socket hangup'))
    .mockResolvedValue({ structuredContent: { success: true } });
  await expect(
    recoverCartAdd(callTool, minted, product.id, 1, undefined, [
      { product, quantity: 1 },
      { product: second, quantity: 1 },
      { product: third, quantity: 1 },
    ])
  ).rejects.toThrow('Guest cart recovery did not complete; retry the add.');
  // The clicked line plus the replayed survivor are emptied with the
  // fresh token (token-bound updates, not quota mints); the never-
  // replayed third line needs no cleanup.
  expect(callTool).toHaveBeenCalledWith({
    product_id: product.id,
    quantity: 0,
    cart_token: fresh,
  });
  expect(callTool).toHaveBeenCalledWith({
    product_id: second.id,
    quantity: 0,
    cart_token: fresh,
  });
  expect(callTool).not.toHaveBeenCalledWith({
    product_id: third.id,
    quantity: 0,
    cart_token: fresh,
  });
});

it('keeps the recovery error when retire cleanup itself fails', async () => {
  const minted = success(fresh, [product.id]);
  const callTool = vi
    .fn()
    .mockRejectedValueOnce(new Error('socket hangup'))
    .mockRejectedValue(new Error('still down'));
  await expect(
    recoverCartAdd(callTool, minted, product.id, 1, undefined, [
      { product, quantity: 1 },
      { product: second, quantity: 1 },
    ])
  ).rejects.toThrow('Guest cart recovery did not complete; retry the add.');
  // First replay throws, first cleanup throws, cleanup aborts fast:
  // two calls, and the recovery error survives.
  expect(callTool).toHaveBeenCalledTimes(2);
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
  // The caller's initial mint already landed before the gate ran: retire
  // its single line so the retry does not orphan another seven-day row.
  expect(callTool).toHaveBeenCalledTimes(1);
  expect(callTool).toHaveBeenCalledWith({
    product_id: product.id,
    quantity: 0,
    cart_token: fresh,
  });
});

it('still reports full when the tokenless retire fails', async () => {
  const minted = success(fresh, [product.id]);
  const callTool = vi.fn().mockRejectedValueOnce(new Error('down'));
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
});

it('passes typed failures through a full local cart instead of masking them', async () => {
  const token = 'a'.repeat(64);
  const selecting = {
    structuredContent: {
      success: false,
      requires_variant_selection: true,
      product_id: product.id,
      product_url: 'https://ogabassey.com/products/phone',
    },
  };
  const denied = {
    structuredContent: {
      success: false,
      quota_exceeded: true,
      retry_after_seconds: 60,
    },
  };
  const callTool = vi.fn();
  const survivors = Array.from({ length: 20 }, (_, index) =>
    survivorAt(index)
  );
  // Active token, option-bearing product: the selection page must open,
  // not a spurious remove-a-line refusal.
  await expect(
    recoverCartAdd(callTool, selecting, product.id, 1, token, [
      { product, quantity: 1 },
      ...survivors,
    ])
  ).resolves.toEqual({ result: selecting, skippedSurvivors: [] });
  // Tokenless quota denial: the retry-after must surface, not cart_full.
  await expect(
    recoverCartAdd(callTool, denied, product.id, 1, undefined, [
      { product, quantity: 1 },
      ...survivors,
    ])
  ).resolves.toEqual({ result: denied, skippedSurvivors: [] });
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
