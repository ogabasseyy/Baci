import { expect, it } from 'vitest';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);
const LIVE = new Date(Date.now() + 86400000).toISOString();
const PAST = new Date(Date.now() - 3600000).toISOString();

function line(productId: string, quantity = 1) {
  return { product_id: productId, quantity };
}

it('creates a cart at version 1 and reports conflicts on re-creation', async () => {
  const fake = createFakeGuestCartSupabase();
  const created = await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: [line('11111111-1111-4111-8111-111111111111')],
    p_expires_at: LIVE,
    p_expected_version: null,
  });
  expect(created.error).toBeNull();
  expect(created.data).toEqual([{ version: 1, outcome: 'ok' }]);
  const conflict = await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: [],
    p_expires_at: LIVE,
    p_expected_version: null,
  });
  expect(conflict.data).toEqual([{ version: null, outcome: 'conflict' }]);
});

it('reports full past the row cap instead of creating', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.setCapacityLimit(1);
  await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: [],
    p_expires_at: LIVE,
    p_expected_version: null,
  });
  const full = await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_B,
    p_items: [],
    p_expires_at: LIVE,
    p_expected_version: null,
  });
  expect(full.data).toEqual([{ version: null, outcome: 'full' }]);
});

it('gates updates on the current version of a live row', async () => {
  const fake = createFakeGuestCartSupabase();
  await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: [],
    p_expires_at: LIVE,
    p_expected_version: null,
  });
  const updated = await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: [line('11111111-1111-4111-8111-111111111111', 2)],
    p_expires_at: LIVE,
    p_expected_version: 1,
  });
  expect(updated.data).toEqual([{ version: 2, outcome: 'ok' }]);
  const stale = await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: [],
    p_expires_at: LIVE,
    p_expected_version: 1,
  });
  expect(stale.data).toEqual([{ version: 2, outcome: 'conflict' }]);
  const missing = await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_B,
    p_items: [],
    p_expires_at: LIVE,
    p_expected_version: 1,
  });
  expect(missing.data).toEqual([{ version: null, outcome: 'missing' }]);
});

it('reports expired rows without resurrecting them', async () => {
  const fake = createFakeGuestCartSupabase();
  await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: [],
    p_expires_at: PAST,
    p_expected_version: null,
  });
  const expired = await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: [],
    p_expires_at: LIVE,
    p_expected_version: 1,
  });
  expect(expired.data).toEqual([{ version: 1, outcome: 'expired' }]);
  // The row is still there for the caller to reclaim, not resurrected.
  expect(fake.rows.get(TOKEN_A)?.version).toBe(1);
});

it('deletes versioned, unconditionally on null, and never missing rows', async () => {
  const fake = createFakeGuestCartSupabase();
  await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: [],
    p_expires_at: LIVE,
    p_expected_version: null,
  });
  const moved = await fake.supabase.rpc('delete_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_expected_version: 99,
  });
  expect(moved).toEqual({ data: false, error: null });
  const deleted = await fake.supabase.rpc('delete_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_expected_version: 1,
  });
  expect(deleted).toEqual({ data: true, error: null });
  const gone = await fake.supabase.rpc('delete_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_expected_version: null,
  });
  expect(gone).toEqual({ data: false, error: null });
  // NULL is deliberately unconditional for corrupt-row reclaim.
  await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_B,
    p_items: [],
    p_expires_at: LIVE,
    p_expected_version: null,
  });
  const reclaimed = await fake.supabase.rpc('delete_mcp_guest_cart', {
    p_token: TOKEN_B,
    p_expected_version: null,
  });
  expect(reclaimed).toEqual({ data: true, error: null });
});

it('reads rows back and returns zero rows for unknown tokens', async () => {
  const fake = createFakeGuestCartSupabase();
  const items = [line('11111111-1111-4111-8111-111111111111')];
  await fake.supabase.rpc('upsert_mcp_guest_cart', {
    p_token: TOKEN_A,
    p_items: items,
    p_expires_at: LIVE,
    p_expected_version: null,
  });
  const found = await fake.supabase.rpc('get_mcp_guest_cart', {
    p_token: TOKEN_A,
  });
  expect(found).toEqual({
    data: [{ items, expires_at: LIVE, version: 1 }],
    error: null,
  });
  const unknown = await fake.supabase.rpc('get_mcp_guest_cart', {
    p_token: TOKEN_B,
  });
  expect(unknown).toEqual({ data: [], error: null });
});

it('rejects malformed inputs with invalid-parameter errors', async () => {
  const fake = createFakeGuestCartSupabase();
  for (const params of [
    { p_token: 'nope', p_items: [], p_expires_at: LIVE },
    { p_token: TOKEN_A, p_items: {}, p_expires_at: LIVE },
    {
      p_token: TOKEN_A,
      p_items: Array.from({ length: 21 }, (_, index) =>
        line(`11111111-1111-4111-8111-${String(index).padStart(12, '0')}`)
      ),
      p_expires_at: LIVE,
    },
    {
      p_token: TOKEN_A,
      p_items: [],
      p_expires_at: new Date(Date.now() + 9 * 86400000).toISOString(),
    },
    { p_token: TOKEN_A, p_items: [{ quantity: 1 }], p_expires_at: LIVE },
    {
      p_token: TOKEN_A,
      p_items: [{ product_id: 'not-a-uuid', quantity: 1 }],
      p_expires_at: LIVE,
    },
    {
      p_token: TOKEN_A,
      p_items: [
        {
          product_id: '11111111-1111-4111-8111-111111111111',
          quantity: 1,
          note: 'x'.repeat(9000),
        },
      ],
      p_expires_at: LIVE,
    },
  ]) {
    const failed = await fake.supabase.rpc('upsert_mcp_guest_cart', {
      ...params,
      p_expected_version: null,
    });
    expect(failed.data).toBeNull();
    expect(failed.error).toMatchObject({ code: '22023' });
  }
  const unknown = await fake.supabase.rpc('no_such_function', {});
  expect(unknown.data).toBeNull();
  expect(unknown.error).toMatchObject({ code: '42883' });
});

it('fails injected transports and records every call', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.failNextRpc({ code: 'XX000', message: 'boom' });
  const failed = await fake.supabase.rpc('get_mcp_guest_cart', {
    p_token: TOKEN_A,
  });
  expect(failed).toEqual({
    data: null,
    error: { code: 'XX000', message: 'boom' },
  });
  // The injection is one-shot: the next call runs normally.
  const next = await fake.supabase.rpc('get_mcp_guest_cart', {
    p_token: TOKEN_A,
  });
  expect(next.error).toBeNull();
  expect(fake.calls).toHaveLength(2);
  expect(fake.calls[0]).toEqual({
    name: 'get_mcp_guest_cart',
    params: { p_token: TOKEN_A },
  });
});

it('runs intercepts before the RPC so tests can stage races', async () => {
  const fake = createFakeGuestCartSupabase();
  const seen: string[] = [];
  fake.intercept((name) => {
    seen.push(name);
  });
  await fake.supabase.rpc('get_mcp_guest_cart', { p_token: TOKEN_A });
  expect(seen).toEqual(['get_mcp_guest_cart']);
});
