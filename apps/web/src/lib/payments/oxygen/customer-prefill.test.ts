import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { readOxygenCustomerPrefill } from './customer-prefill';

function fixture(order: unknown, customer: unknown, error: unknown = null) {
  const orderQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: order, error: null }),
  };
  const customerQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: customer, error }),
  };
  const client = {
    from: vi.fn((table: string) =>
      table === 'orders' ? orderQuery : customerQuery
    ),
  };
  return { client, orderQuery, customerQuery };
}
describe('Oxygen customer prefill', () => {
  it('loads only the signed-in order customer in the same merchant', async () => {
    const f = fixture(
      {
        customer_id: 'customer',
        merchant_id: 'merchant',
        customer_email: 'checkout@example.com',
      },
      {
        first_name: ' Ada ',
        last_name: 'Okon',
        email: 'ada@example.com',
        date_of_birth: '1990-02-10',
        bvn: '12345678901',
      }
    );
    expect(
      await readOxygenCustomerPrefill(
        f.client as unknown as SupabaseClient,
        'order',
        'user'
      )
    ).toEqual({
      first_name: 'Ada',
      last_name: 'Okon',
      email: 'ada@example.com',
      date_of_birth: '1990-02-10',
    });
    expect(f.orderQuery.eq).toHaveBeenCalledWith('id', 'order');
    expect(f.customerQuery.eq.mock.calls).toEqual([
      ['id', 'customer'],
      ['merchant_id', 'merchant'],
      ['user_id', 'user'],
    ]);
    expect(f.customerQuery.select).toHaveBeenCalledWith(
      'first_name, last_name, email, date_of_birth'
    );
  });
  it('does not expose order details to a different customer', async () => {
    const f = fixture(
      {
        customer_id: 'other',
        merchant_id: 'merchant',
        customer_email: 'private@example.com',
      },
      null
    );
    expect(
      await readOxygenCustomerPrefill(
        f.client as unknown as SupabaseClient,
        'order',
        'user'
      )
    ).toEqual({});
  });
  it('uses checkout email only after customer ownership and leaves invalid/missing fields blank', async () => {
    const f = fixture(
      {
        customer_id: 'customer',
        merchant_id: 'merchant',
        customer_email: 'checkout@example.com',
      },
      {
        first_name: null,
        last_name: '',
        email: 'invalid',
        date_of_birth: 'not-a-date',
      }
    );
    expect(
      await readOxygenCustomerPrefill(
        f.client as unknown as SupabaseClient,
        'order',
        'user'
      )
    ).toEqual({
      email: 'checkout@example.com',
    });
  });
  it('fails closed on profile query errors without blocking manual entry', async () => {
    const f = fixture(
      { customer_id: 'customer', merchant_id: 'merchant' },
      { first_name: 'private' },
      { code: 'database_error' }
    );
    expect(
      await readOxygenCustomerPrefill(
        f.client as unknown as SupabaseClient,
        'order',
        'user'
      )
    ).toEqual({});
  });
  it('does not query profiles for absent orders', async () => {
    const f = fixture(null, null);
    expect(
      await readOxygenCustomerPrefill(
        f.client as unknown as SupabaseClient,
        'order',
        'user'
      )
    ).toEqual({});
    expect(f.client.from).toHaveBeenCalledTimes(1);
  });
});
