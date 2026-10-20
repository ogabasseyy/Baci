import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

const order = { currency: 'NGN', id: 'order-1' };

function database({
  payments,
  paymentError = null,
  refunds,
  refundError = null,
  walletReversals = [],
  walletError = null,
  savingsReversals = [],
  savingsError = null,
}: {
  payments: unknown[];
  paymentError?: unknown;
  refunds: unknown[];
  refundError?: unknown;
  walletReversals?: unknown[];
  walletError?: unknown;
  savingsReversals?: unknown[];
  savingsError?: unknown;
}) {
  const paymentQuery = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: payments, error: paymentError }),
    select: vi.fn().mockReturnThis(),
  };
  const refundQuery = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn((column: string) =>
      column === 'status'
        ? Promise.resolve({ data: refunds, error: refundError })
        : refundQuery
    ),
    select: vi.fn().mockReturnThis(),
  };
  const terminal = (data: unknown[], error: unknown) => ({
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    then: (resolve: (value: unknown) => void) =>
      Promise.resolve({ data, error }).then(resolve),
  });
  const from = vi
    .fn()
    .mockReturnValueOnce(paymentQuery)
    .mockReturnValueOnce(refundQuery)
    .mockReturnValueOnce(terminal(walletReversals, walletError))
    .mockReturnValueOnce(terminal(savingsReversals, savingsError));
  return {
    refundQuery,
    supabase: { from } as unknown as SupabaseClient,
  };
}

export const refundNotificationLedgerTestKit = {
  database,
  order,
};
