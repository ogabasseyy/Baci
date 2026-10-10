import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import {
  GuestCartExpiredError,
  GuestCartFullError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';
import { GuestCartStore } from './guest-cart-store';
import { describeGuestCartStoreHealth } from './guest-cart-health';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const lineId = (index: number) =>
  `11111111-1111-4111-8111-${index.toString(16).padStart(12, '0')}`;
const token = 'a'.repeat(64);
const liveRow = (items: unknown[] = []) => ({
  items,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  version: 1,
});
const validate = async () => {};

function storeOn(supabase: SupabaseClient) {
  return new GuestCartStore(supabase);
}

it('creates a cart with a fresh token and a seven-day expiry', async () => {
  const fake = createFakeGuestCartSupabase();
  const before = Date.now();
  const result = await storeOn(fake.supabase).update(
    undefined,
    { product_id: id, quantity: 2 },
    validate
  );
  expect(result.cart_token).toMatch(/^[a-f0-9]{64}$/);
  expect(result.items).toEqual([{ product_id: id, quantity: 2 }]);
  expect(Date.parse(result.expires_at)).toBeGreaterThanOrEqual(
    before + 7 * 86400000
  );
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0]).toMatchObject({
    name: 'upsert_mcp_guest_cart',
    params: { p_expected_version: null },
  });
});

it('merges an added line, replacing the same product absolutely', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow([{ product_id: id, quantity: 2 }]));
  const result = await storeOn(fake.supabase).update(
    token,
    { product_id: id, quantity: 5 },
    validate
  );
  expect(result).toMatchObject({
    cart_token: token,
    items: [{ product_id: id, quantity: 5 }],
  });
  expect(fake.rows.get(token)?.version).toBe(2);
});

it('removes one line at quantity 0 and keeps the rest', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(
    token,
    liveRow([
      { product_id: id, quantity: 2 },
      { product_id: other, quantity: 1 },
    ])
  );
  const result = await storeOn(fake.supabase).update(
    token,
    { product_id: id, quantity: 0 },
    validate
  );
  expect(result.items).toEqual([{ product_id: other, quantity: 1 }]);
  expect(result).not.toHaveProperty('cart_emptied');
});

it('retires the token when the last line is removed', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow([{ product_id: id, quantity: 2 }]));
  const store = storeOn(fake.supabase);
  const result = await store.update(token, { product_id: id, quantity: 0 }, validate);
  expect(result).toMatchObject({ cart_token: token, items: [], cart_emptied: true });
  expect(fake.rows.has(token)).toBe(false);
  await expect(
    store.update(token, { product_id: id, quantity: 1 }, validate)
  ).rejects.toBeInstanceOf(GuestCartExpiredError);
});

it('rejects a tokenless removal and a malformed token', async () => {
  const fake = createFakeGuestCartSupabase();
  const store = storeOn(fake.supabase);
  await expect(
    store.update(undefined, { product_id: id, quantity: 0 }, validate)
  ).rejects.toThrow('A guest cart is required');
  await expect(
    store.update('nope', { product_id: id, quantity: 1 }, validate)
  ).rejects.toThrow('Invalid guest cart');
  expect(fake.calls).toHaveLength(0);
});

it('canonicalizes product IDs before persisting', async () => {
  const fake = createFakeGuestCartSupabase();
  const result = await storeOn(fake.supabase).update(
    undefined,
    { product_id: id.toUpperCase(), quantity: 1 },
    validate
  );
  expect(result.items).toEqual([{ product_id: id, quantity: 1 }]);
});

it('enforces the per-cart line cap', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(
    token,
    liveRow(
      Array.from({ length: 20 }, (_, index) => ({
        product_id: lineId(index),
        quantity: 1,
      }))
    )
  );
  await expect(
    storeOn(fake.supabase).update(token, { product_id: id, quantity: 1 }, validate)
  ).rejects.toBeInstanceOf(GuestCartFullError);
});

it('reports an expired token and reclaims its row', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, {
    items: [{ product_id: id, quantity: 1 }],
    expires_at: new Date(Date.now() - 1000).toISOString(),
    version: 3,
  });
  await expect(
    storeOn(fake.supabase).update(token, { product_id: id, quantity: 1 }, validate)
  ).rejects.toBeInstanceOf(GuestCartExpiredError);
  expect(fake.rows.has(token)).toBe(false);
});

it('reports unknown and corrupt rows as expired', async () => {
  const fake = createFakeGuestCartSupabase();
  const store = storeOn(fake.supabase);
  await expect(
    store.update(token, { product_id: id, quantity: 1 }, validate)
  ).rejects.toBeInstanceOf(GuestCartExpiredError);
  fake.rows.set(token, { items: [{ nope: true }], expires_at: new Date().toISOString(), version: 1 });
  await expect(
    store.update(token, { product_id: id, quantity: 1 }, validate)
  ).rejects.toBeInstanceOf(GuestCartExpiredError);
  expect(fake.rows.has(token)).toBe(false);
});

it('surfaces transport failures as typed outages and clears them on success', async () => {
  const fake = createFakeGuestCartSupabase();
  const store = storeOn(fake.supabase);
  fake.failNextRpc({ code: 'XX000', message: 'boom' });
  const failure = await store
    .update(undefined, { product_id: id, quantity: 1 }, validate)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GuestCartStorageUnavailableError);
  expect((failure as GuestCartStorageUnavailableError).code).toBe('XX000');
  expect(store.lastStorageErrorCode).toBe('XX000');
  expect(describeGuestCartStoreHealth(store).guestCarts).toBe('degraded');
  const result = await store.update(undefined, { product_id: id, quantity: 1 }, validate);
  expect(result.items).toHaveLength(1);
  expect(store.lastStorageErrorCode).toBeNull();
  expect(describeGuestCartStoreHealth(store)).toEqual({ guestCarts: 'ok' });
});

it('probes liveness without throwing, even on outage', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow([]));
  const store = storeOn(fake.supabase);
  await expect(store.hasToken(token)).resolves.toBe(true);
  await expect(store.hasToken('b'.repeat(64))).resolves.toBe(false);
  await expect(store.hasToken('nope')).resolves.toBe(false);
  fake.failNextRpc({ code: 'XX000', message: 'boom' });
  await expect(store.hasToken(token)).resolves.toBe(false);
  // Probes never record health: only writes do.
  expect(store.lastStorageErrorCode).toBeNull();
});

it('validates creations before any RPC and updates after merging', async () => {
  const fake = createFakeGuestCartSupabase();
  const store = storeOn(fake.supabase);
  const seen: unknown[][] = [];
  const created = await store.update(
    undefined,
    { product_id: id, quantity: 1 },
    async (items) => {
      seen.push(items);
    }
  );
  expect(fake.calls).toHaveLength(1);
  await store.update(
    created.cart_token,
    { product_id: other, quantity: 2 },
    async (items) => {
      seen.push(items);
    }
  );
  expect(seen).toEqual([
    [{ product_id: id, quantity: 1 }],
    [
      { product_id: id, quantity: 1 },
      { product_id: other, quantity: 2 },
    ],
  ]);
  const rejected = vi.fn(async () => {
    throw new Error('stale line');
  });
  await expect(
    store.update(created.cart_token, { product_id: other, quantity: 3 }, rejected)
  ).rejects.toThrow('stale line');
  // A rejected creation never reaches storage.
  const callsBefore = fake.calls.length;
  await expect(
    store.update(undefined, { product_id: id, quantity: 1 }, rejected)
  ).rejects.toThrow('stale line');
  expect(fake.calls.length).toBe(callsBefore);
});

it('reclaims a corrupt row with an unconditional delete and reports no cart', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow('not-an-array' as unknown as never[]));
  const store = storeOn(fake.supabase);
  await expect(store.hasToken(token)).resolves.toBe(false);
  // The row read back unparseable, so its version is untrusted: the
  // reclaim delete must not pin a version that can never match (NULL
  // deletes unconditionally), and the row must actually be gone.
  expect(
    fake.calls.filter((call) => call.name === 'delete_mcp_guest_cart')
  ).toEqual([
    {
      name: 'delete_mcp_guest_cart',
      params: { p_token: token, p_expected_version: null },
    },
  ]);
  expect(fake.rows.has(token)).toBe(false);
});

it('fails creation with a retry-later code when the table is at capacity', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.setCapacityLimit(0);
  const store = storeOn(fake.supabase);
  // A 'full' outcome is terminal for this attempt: no token-mint retry
  // can succeed while the gate holds, so the store surfaces it once.
  const outcome = await store
    .update(undefined, { product_id: id, quantity: 1 }, validate)
    .then(
      () => 'created',
      (error: unknown) =>
        error instanceof GuestCartStorageUnavailableError
          ? error.code
          : 'wrong-error'
    );
  expect(outcome).toBe('capacity_exhausted');
  expect(store.lastStorageErrorCode).toBe('capacity_exhausted');
  expect(fake.calls).toHaveLength(1);
});
