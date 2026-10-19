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
      'expires_at.is.null,expires_at.gt.2026-08-27T10:15:00.000Z'
    );
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(result.paymentAccount?.account_number).toBe('2222222222');
    expect(result.error).toBeNull();
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
});
