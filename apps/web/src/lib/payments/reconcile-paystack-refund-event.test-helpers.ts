import { vi } from 'vitest';

export const REFUND_FIXTURE = {
  id: 'refund-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  gateway_reference: '42',
  amount: 100,
  currency: 'NGN',
  metadata: {
    payment_transaction_id: '11111111-1111-4111-8111-111111111111',
    provider_payment_transaction_id: 123,
  },
  status: 'refund_pending',
};

export function cancelledPaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    order_id: 'order-1',
    merchant_id: 'merchant-1',
    amount: 100,
    currency: 'NGN',
    cancel_order: {
      cancelled_at: '2026-09-27T00:00:00Z',
      shipping_status: 'cancelled',
    },
    ...overrides,
  };
}

export function buildPaymentCandidates(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
}

export function buildRefundCandidates(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
    then: (resolve: (result: unknown) => void) => resolve({ data, error }),
  };
  for (const key of ['select', 'eq', 'in', 'order', 'limit', 'gt']) {
    builder[key] = vi.fn().mockReturnValue(builder);
  }
  return builder;
}

export function buildSettledCandidates(data: unknown) {
  const builder: Record<string, unknown> = {
    limit: vi.fn().mockResolvedValue({ data, error: null }),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
    then: (resolve: (result: unknown) => void) =>
      resolve({ data, error: null }),
  };
  for (const key of ['eq', 'gt', 'is', 'not', 'select']) {
    builder[key] = vi.fn().mockReturnValue(builder);
  }
  return builder;
}

export function buildPaymentLookup() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        order_id: 'order-1',
        merchant_id: 'merchant-1',
        gateway_reference: 'PSK-1',
        amount: 100,
        currency: 'NGN',
        status: 'completed',
      },
      error: null,
    }),
  };
}

export function buildReviewInsert(error: unknown = null) {
  return { insert: vi.fn().mockResolvedValue({ error }) };
}
