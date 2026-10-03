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

describe('resolveInvoicePaymentAccount', () => {
  it('filters unpaid invoice accounts at the query boundary and selects the active Paystack row', async () => {
    const query = createQuery({
      data: [
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
    const now = new Date('2026-08-27T10:15:00.000Z');

    const result = await resolveInvoicePaymentAccount(
      supabase,
      'order-1',
      false,
      now
    );

    expect(query.or).toHaveBeenNthCalledWith(
      1,
      'assignment_customer_email_source.is.null,assignment_customer_email_source.neq.legacy_untrusted'
    );
    expect(query.or).toHaveBeenNthCalledWith(
      2,
      // Future assignments are selector-invisible: exclude them at the
      // database so the selector never sees a row it would reject while
      // starving the older eligible fallback.
      'assigned_at.lte.2026-08-27T10:15:00.000Z,and(assigned_at.is.null,created_at.lte.2026-08-27T10:15:00.000Z),and(assigned_at.is.null,created_at.is.null)'
    );
    expect(query.or).toHaveBeenNthCalledWith(
      3,
      // 15-minute validity buffer past now (10:15): an account expiring
      // mid-delivery must not be printed on the invoice.
      'expires_at.is.null,expires_at.gt.2026-08-27T10:30:00.000Z'
    );
    // No LIMIT: the shared selector ranks Paystack above newer
    // non-Paystack rows, so it must see every eligible row.
    expect(query.limit).not.toHaveBeenCalled();
    expect(result.paymentAccount?.account_number).toBe('2222222222');
    expect(result.error).toBeNull();
  });

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

  it('keeps an expired Paystack account for a paid invoice history', async () => {
    const query = createQuery({
      data: [
        {
          account_name: 'Historical confirmation',
          account_number: '2222222222',
          assigned_at: '2026-08-27T10:00:00.000Z',
          bank_name: 'Paystack',
          created_at: '2026-08-27T10:00:00.000Z',
          expires_at: '2026-08-27T10:05:00.000Z',
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
      true,
      new Date('2026-08-27T10:15:00.000Z')
    );

    expect(query.limit).not.toHaveBeenCalled();
    expect(result.paymentAccount?.account_number).toBe('2222222222');
  });

  it('uses the paid transaction receiver instead of the newest historical alias', async () => {
    const paymentAccountQuery = createQuery({
      data: [
        {
          account_name: 'Paid DVA',
          account_number: '1111111111',
          assigned_at: '2026-08-27T10:00:00.000Z',
          bank_name: 'Paystack',
          created_at: '2026-08-27T10:00:00.000Z',
          expires_at: '2026-08-27T10:05:00.000Z',
          provider: 'paystack',
        },
        {
          account_name: 'Newer DVA',
          account_number: '2222222222',
          assigned_at: '2026-08-27T10:10:00.000Z',
          bank_name: 'Paystack',
          created_at: '2026-08-27T10:10:00.000Z',
          expires_at: '2026-08-27T10:15:00.000Z',
          provider: 'paystack',
        },
      ],
      error: null,
    });
    const transactionQuery = createQuery({
      data: [
        {
          created_at: '2026-08-27T10:20:00.000Z',
          gateway: 'paystack',
          metadata: { dva_account_number: '1111111111' },
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    const supabase = {
      from: vi.fn((table: string) =>
        table === 'transactions' ? transactionQuery : paymentAccountQuery
      ),
    } as unknown as SupabaseClient<Database>;

    const result = await resolveInvoicePaymentAccount(
      supabase,
      'order-1',
      true,
      new Date('2026-08-27T10:30:00.000Z')
    );

    expect(result.paymentAccount?.account_number).toBe('1111111111');
  });

  it('returns the lookup error without selecting a payment account', async () => {
    const error = new Error('database unavailable');
    const query = createQuery({ data: null, error });
    const supabase = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient<Database>;

    const result = await resolveInvoicePaymentAccount(
      supabase,
      'order-1',
      false,
      new Date('2026-08-27T10:15:00.000Z')
    );

    expect(result.error).toBe(error);
    expect(result.paymentAccount).toBeNull();
  });

  it('returns a paid transaction lookup error alongside the payment account result', async () => {
    const transactionError = new Error('transaction lookup unavailable');
    const transactionQuery = createQuery({
      data: null,
      error: transactionError,
    });
    const paymentAccountQuery = createQuery({
      data: [
        {
          account_name: 'Automatic confirmation',
          account_number: '2222222222',
          bank_name: 'Paystack',
          created_at: '2026-08-27T10:00:00.000Z',
          expires_at: '2026-08-27T11:30:00.000Z',
          provider: 'paystack',
        },
      ],
      error: null,
    });
    const supabase = {
      from: vi.fn((table: string) =>
        table === 'transactions' ? transactionQuery : paymentAccountQuery
      ),
    } as unknown as SupabaseClient<Database>;

    const result = await resolveInvoicePaymentAccount(
      supabase,
      'order-1',
      true,
      new Date('2026-08-27T10:15:00.000Z')
    );

    expect(result.transactionError).toBe(transactionError);
    expect(result.error).toBeNull();
  });

  it('breaks created_at ties by account number like the dispatch recheck', async () => {
    const query = createQuery({ data: [], error: null });
    const supabase = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient<Database>;

    await resolveInvoicePaymentAccount(
      supabase,
      'order-1',
      false,
      new Date('2026-08-27T10:15:00.000Z')
    );

    // Null-created legacy rows sort last, matching the shared selector
    // (-infinity) and the dispatch recheck (NULLS LAST).
    expect(query.order).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: false,
      nullsFirst: false,
    });
    expect(query.order).toHaveBeenNthCalledWith(2, 'account_number', {
      ascending: false,
    });
  });
});
