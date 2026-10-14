import type { SupabaseClient, User } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { verifyCartCustomer } from './verified-customer';

const merchant = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const principal = {
  merchantId: merchant,
  cartId: null,
  grantId: null,
  principalId: 'guest',
  scope: 'bootstrap' as const,
  allowedOperations: [],
  expiresAt: '2099-01-01T00:00:00Z',
};
const user: User = {
  id: userId,
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  email: 'same@example.test',
};
function client(row: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return { from, query, value: { from } as unknown as SupabaseClient };
}
it('requires the authenticated user id and merchant relationship, never matching by email', async () => {
  const db = client({ id: customerId, user_id: userId, merchant_id: merchant });
  const result = await verifyCartCustomer(principal, {
    user,
    supabase: db.value,
    error: null,
  });
  expect(result.ok).toBe(true);
  expect(db.query.eq.mock.calls).toEqual([
    ['merchant_id', merchant],
    ['user_id', userId],
  ]);
  expect(db.query.select).toHaveBeenCalledWith('id, merchant_id, user_id');
  const other = client({
    id: customerId,
    user_id: customerId,
    merchant_id: merchant,
    email: user.email,
  });
  expect(
    (
      await verifyCartCustomer(principal, {
        user,
        supabase: other.value,
        error: null,
      })
    ).ok
  ).toBe(false);
});
it('rejects another merchant and anonymous requests before privileged cart signing', async () => {
  const db = client({
    id: customerId,
    user_id: userId,
    merchant_id: customerId,
  });
  expect(
    (
      await verifyCartCustomer(principal, {
        user,
        supabase: db.value,
        error: null,
      })
    ).ok
  ).toBe(false);
  db.from.mockClear();
  expect(
    (
      await verifyCartCustomer(principal, {
        user: null,
        supabase: null,
        error: 'signed out',
      })
    ).ok
  ).toBe(false);
  expect(db.from).not.toHaveBeenCalled();
});
