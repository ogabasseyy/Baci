import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

const payment = {
  amount: 100,
  gateway_reference: 'PSK-1',
  id: 'pay-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};
const order = {
  cancelled_at: '2026-09-27T00:00:00Z',
  id: 'order-1',
  order_number: 'B-1',
  shipping_status: 'cancelled',
};

function selectQuery(data: unknown, error: unknown = null) {
  return {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    then: (resolve: (value: unknown) => void) => resolve({ data, error }),
  };
}

function database({
  insertError = null,
  orderRow = order,
  paymentRows = [payment],
  racedRow = null,
}: {
  insertError?: unknown;
  orderRow?: unknown;
  paymentRows?: unknown[];
  racedRow?: unknown;
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const from = vi
    .fn()
    .mockReturnValueOnce(selectQuery(paymentRows))
    .mockReturnValueOnce(selectQuery(orderRow))
    .mockReturnValueOnce({ insert })
    .mockReturnValueOnce(selectQuery(racedRow));
  return { from, insert, supabase: { from } as unknown as SupabaseClient };
}

export const recoverUnknownPaystackRefundTestKit = {
  database,
  order,
};
