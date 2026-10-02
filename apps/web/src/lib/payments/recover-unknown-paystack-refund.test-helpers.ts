import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

const payment = {
  amount: 100,
  gateway: 'paystack',
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
    ilike: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data, error }),
    gt: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
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
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const from = vi.fn().mockReturnValueOnce(selectQuery(paymentRows));
  if (paymentRows.length > 0) {
    // The completed scan repeats until a pass adds nothing: the
    // stabilizing pass observes the same rows and stops.
    from.mockReturnValueOnce(selectQuery(paymentRows));
  }
  from
    .mockReturnValueOnce(selectQuery(orderRow))
    .mockReturnValueOnce({ insert })
    .mockReturnValueOnce(selectQuery(racedRow));
  return {
    from,
    insert,
    rpc,
    supabase: { from, rpc } as unknown as SupabaseClient,
  };
}

export const recoverUnknownPaystackRefundTestKit = {
  database,
  order,
};
