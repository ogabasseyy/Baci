import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import { resolveInvoicePaymentAccount } from './invoice-payment-account';

function createQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(result),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaitable.
    then: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  };

  return query;
}

describe('resolveInvoicePaymentAccount provider selection', () => {
  it('prints an order-specific Korapay assignment when no Paystack row exists', async () => {
    const query = createQuery({
      data: [
        {
          account_name: 'Shop Ltd/ORD',
          account_number: '5555555555',
          assigned_at: '2026-08-27T10:00:00.000Z',
          bank_name: 'Korapay',
          created_at: '2026-08-27T10:00:00.000Z',
          expires_at: null,
          provider: 'korapay',
        },
      ],
      error: null,
    });
    const supabase = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient<Database>;

    const result = await resolveInvoicePaymentAccount(
      supabase,
      'order-1',
      false,
      new Date('2026-08-27T10:15:00.000Z')
    );

    expect(query.limit).not.toHaveBeenCalled();
    expect(result.paymentAccount?.account_number).toBe('5555555555');
    expect(result.paymentAccount?.provider).toBe('korapay');
  });

  it('rejects an account expiring inside the delivery buffer', async () => {
    const query = createQuery({
      data: [
        {
          account_name: 'Shop Ltd/ORD',
          account_number: '5555555555',
          assigned_at: '2026-08-27T10:00:00.000Z',
          bank_name: 'Korapay',
          created_at: '2026-08-27T10:00:00.000Z',
          expires_at: '2026-08-27T10:20:00.000Z',
          provider: 'korapay',
        },
      ],
      error: null,
    });
    const supabase = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient<Database>;

    const result = await resolveInvoicePaymentAccount(
      supabase,
      'order-1',
      false,
      new Date('2026-08-27T10:15:00.000Z')
    );

    // Expiring 5 minutes out: the selector encodes the same 15-minute
    // buffer as the database pre-filter, so an account expiring
    // mid-delivery is never printed even if a row slips past the query.
    expect(result.paymentAccount).toBeNull();
    expect(result.error).toBeNull();
  });

  it('prefers an older Paystack row over a newer Korapay assignment', async () => {
    const query = createQuery({
      data: [
        {
          account_name: 'Shop Ltd/ORD',
          account_number: '5555555555',
          assigned_at: '2026-08-27T10:10:00.000Z',
          bank_name: 'Korapay',
          created_at: '2026-08-27T10:10:00.000Z',
          expires_at: null,
          provider: 'korapay',
        },
        {
          account_name: 'Automatic confirmation',
          account_number: '2222222222',
          assigned_at: '2026-08-27T10:00:00.000Z',
          bank_name: 'Paystack',
          created_at: '2026-08-27T10:00:00.000Z',
          expires_at: '2026-08-27T11:30:00.000Z',
          provider: 'paystack',
        },
      ],
      error: null,
    });
    const supabase = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient<Database>;

    const result = await resolveInvoicePaymentAccount(
      supabase,
      'order-1',
      false,
      new Date('2026-08-27T10:15:00.000Z')
    );

    // Paystack ranks first in the shared selector (and the atomic
    // recheck) because only its DVA rows match the Paystack webhook.
    expect(result.paymentAccount?.account_number).toBe('2222222222');
  });
});
