import { vi } from 'vitest';
import {
  merchant,
  order,
  paystackPayment,
} from './execute-order-cancellation-side-effect.test-support';

export { merchant, order, paystackPayment };

export const linkedPaymentId = (row: { metadata: unknown }): string | null => {
  const claimed = (row.metadata as { payment_transaction_id?: unknown } | null)
    ?.payment_transaction_id;
  return typeof claimed === 'string' ? claimed : null;
};

export function preflightSupabase() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return {
    from: vi.fn().mockReturnValue({ insert }),
    insert,
    rpc: vi.fn(),
  };
}

export function preflightInput(overrides: Record<string, unknown> = {}) {
  return {
    auditBlockedLegIds: new Set<string>(),
    linkedPaymentId,
    manualLinkedLegIds: new Set<string>(),
    mismatchedIds: new Set<string>(),
    order: order as never,
    refundedPaymentIds: new Set<string>(),
    refundRows: [],
    supabase: preflightSupabase() as never,
    transactions: [paystackPayment as never],
    ...overrides,
  };
}
