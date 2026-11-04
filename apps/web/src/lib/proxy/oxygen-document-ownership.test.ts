import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { verifyOxygenDocumentOwnership } from './oxygen-document-ownership';

function clientFor({
  user = 'user',
  order = {
    id: 'order',
    merchant_id: 'merchant',
    customer_id: 'customer',
    payment_method: 'oxygen',
  },
  customer = { id: 'customer', merchant_id: 'merchant', user_id: 'user' },
  merchant = { id: 'merchant', slug: 'shop' },
  error = false,
} = {}) {
  const reads: string[] = [];
  const rows: Record<string, unknown> = {
    orders: order,
    customers: customer,
    merchants: merchant,
  };
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: user ? { id: user } : null },
        error: error ? new Error('auth') : null,
      })),
    },
    from: (table: string) => {
      reads.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: rows[table], error: null }),
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, reads };
}

it('requires a verified user, owned customer, order and matching trusted merchant', async () => {
  const good = clientFor();
  expect(
    await verifyOxygenDocumentOwnership(good.client, 'order', 'shop')
  ).toBe(true);
  expect(good.reads).toEqual(['orders', 'customers', 'merchants']);
  expect(
    await verifyOxygenDocumentOwnership(
      clientFor({
        order: {
          id: 'order',
          merchant_id: 'merchant',
          customer_id: 'customer',
          payment_method: 'paystack',
        },
      }).client,
      'order',
      'shop'
    )
  ).toBe(false);
  expect(
    await verifyOxygenDocumentOwnership(
      clientFor({ user: '' }).client,
      'order',
      'shop'
    )
  ).toBe(false);
  expect(
    await verifyOxygenDocumentOwnership(
      clientFor({ error: true }).client,
      'order',
      'shop'
    )
  ).toBe(false);
  expect(
    await verifyOxygenDocumentOwnership(
      clientFor({
        customer: { id: 'customer', merchant_id: 'merchant', user_id: 'other' },
      }).client,
      'order',
      'shop'
    )
  ).toBe(false);
  expect(
    await verifyOxygenDocumentOwnership(
      clientFor({ merchant: { id: 'merchant', slug: 'other' } }).client,
      'order',
      'shop'
    )
  ).toBe(false);
});
