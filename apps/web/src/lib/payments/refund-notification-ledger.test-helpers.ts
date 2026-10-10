import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

const order = { currency: 'NGN', id: 'order-1' };

function database({
  payments,
  paymentError = null,
  refunds,
  refundError = null,
}: {
  payments: unknown[];
  paymentError?: unknown;
  refunds: unknown[];
  refundError?: unknown;
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
  const from = vi
    .fn()
    .mockReturnValueOnce(paymentQuery)
    .mockReturnValueOnce(refundQuery);
  return {
    refundQuery,
    supabase: { from } as unknown as SupabaseClient,
  };
}

export const refundNotificationLedgerTestKit = {
  database,
  order,
};
