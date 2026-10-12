import { expect, it } from 'vitest';
import {
  GuestCartExpiredError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';
import { GuestCartStore } from './guest-cart-store';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);
const liveRow = (items: unknown[] = [], version = 1) => ({
  items,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  version,
});
const validate = async () => {};

it("retries a conflicted update and keeps both writers' lines", async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow([{ product_id: id, quantity: 1 }]));
  // Another replica wins the version gate between our read and write.
  let bumped = false;
  fake.intercept((name) => {
    if (name === 'upsert_mcp_guest_cart' && !bumped) {
      bumped = true;
      fake.rows.set(token, liveRow([{ product_id: other, quantity: 2 }], 2));
    }
  });
  const result = await new GuestCartStore(fake.supabase).update(
    token,
    { product_id: id, quantity: 5 },
    validate
  );
  expect(result.items).toEqual([
    { product_id: other, quantity: 2 },
    { product_id: id, quantity: 5 },
  ]);
  expect(fake.rows.get(token)?.version).toBe(3);
});

it('fails closed after repeated write conflicts', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow([]));
  // Every write attempt loses the gate: the error must be typed so the
  // tool reports an outage (and /health degrades) instead of success.
  fake.intercept((name) => {
    if (name === 'upsert_mcp_guest_cart') {
      const row = fake.rows.get(token);
      if (row) fake.rows.set(token, { ...row, version: row.version + 1 });
    }
  });
  const store = new GuestCartStore(fake.supabase);
  const failure = await store
    .update(token, { product_id: id, quantity: 1 }, validate)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GuestCartStorageUnavailableError);
  expect((failure as GuestCartStorageUnavailableError).code).toBe(
    'write_conflict'
  );
  expect(store.lastStorageErrorCode).toBe('write_conflict');
});

it('recovers instead of retrying when the row vanishes mid-update', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow([{ product_id: id, quantity: 1 }]));
  fake.intercept((name) => {
    if (name === 'upsert_mcp_guest_cart') fake.rows.delete(token);
  });
  await expect(
    new GuestCartStore(fake.supabase).update(
      token,
      { product_id: id, quantity: 2 },
      validate
    )
  ).rejects.toBeInstanceOf(GuestCartExpiredError);
});

it('recovers instead of retrying when the row expires mid-update', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow([{ product_id: id, quantity: 1 }]));
  fake.intercept((name) => {
    if (name === 'upsert_mcp_guest_cart') {
      const row = fake.rows.get(token);
      if (row)
        fake.rows.set(token, {
          ...row,
          expires_at: new Date(Date.now() - 1000).toISOString(),
        });
    }
  });
  const store = new GuestCartStore(fake.supabase);
  await expect(
    store.update(token, { product_id: id, quantity: 2 }, validate)
  ).rejects.toBeInstanceOf(GuestCartExpiredError);
  // The expired row is reclaimed best-effort on the way out.
  expect(fake.rows.has(token)).toBe(false);
});

it('mints a fresh token when creation collides', async () => {
  const fake = createFakeGuestCartSupabase();
  let collisions = 0;
  fake.intercept((name, params) => {
    if (name === 'upsert_mcp_guest_cart' && collisions === 0) {
      collisions += 1;
      // Occupy the about-to-be-created token so the first attempt conflicts.
      fake.rows.set(params.p_token as string, liveRow([]));
    }
  });
  const result = await new GuestCartStore(fake.supabase).update(
    undefined,
    { product_id: id, quantity: 1 },
    validate
  );
  expect(result.items).toEqual([{ product_id: id, quantity: 1 }]);
  const creations = fake.calls.filter(
    (call) => call.name === 'upsert_mcp_guest_cart'
  );
  expect(creations).toHaveLength(2);
  expect(creations[0].params.p_token).not.toBe(creations[1].params.p_token);
});

it('fails creation closed when collisions repeat', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.intercept((name, params) => {
    if (name === 'upsert_mcp_guest_cart')
      fake.rows.set(params.p_token as string, liveRow([]));
  });
  const failure = await new GuestCartStore(fake.supabase)
    .update(undefined, { product_id: id, quantity: 1 }, validate)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GuestCartStorageUnavailableError);
  expect((failure as GuestCartStorageUnavailableError).code).toBe(
    'create_conflict'
  );
});

it('serializes concurrent updates from this process without losing lines', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow([]));
  const store = new GuestCartStore(fake.supabase);
  const [first, second] = await Promise.all([
    store.update(token, { product_id: id, quantity: 1 }, validate),
    store.update(token, { product_id: other, quantity: 2 }, validate),
  ]);
  // Whichever ran first saw one line; the runner-up merged both.
  expect([first.items.length, second.items.length].sort()).toEqual([1, 2]);
  const stored = [...(fake.rows.get(token)?.items as { product_id: string }[])].sort(
    (left, right) => left.product_id.localeCompare(right.product_id)
  );
  expect(stored).toEqual([
    { product_id: id, quantity: 1 },
    { product_id: other, quantity: 2 },
  ]);
  expect(fake.rows.get(token)?.version).toBe(3);
  // No conflict was ever reported: the in-process mutex chained the two
  // updates instead of racing the version gate.
  const upserts = fake.calls.filter(
    (call) => call.name === 'upsert_mcp_guest_cart'
  );
  expect(upserts).toHaveLength(2);
});

it('retries an emptied-cart delete that loses a concurrent write', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.rows.set(token, liveRow([{ product_id: id, quantity: 1 }]));
  // A concurrent add lands between our read and the emptying delete: the
  // delete misses its version and the retry merges against the new row.
  let bumped = false;
  fake.intercept((name) => {
    if (name === 'delete_mcp_guest_cart' && !bumped) {
      bumped = true;
      fake.rows.set(
        token,
        liveRow(
          [
            { product_id: id, quantity: 1 },
            { product_id: other, quantity: 2 },
          ],
          2
        )
      );
    }
  });
  const result = await new GuestCartStore(fake.supabase).update(
    token,
    { product_id: id, quantity: 0 },
    validate
  );
  expect(result.items).toEqual([{ product_id: other, quantity: 2 }]);
  expect(result).not.toHaveProperty('cart_emptied');
  expect(fake.rows.has(token)).toBe(true);
});
