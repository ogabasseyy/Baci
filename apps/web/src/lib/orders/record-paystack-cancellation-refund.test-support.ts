import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import {
  initiationOrder as testOrder,
  initiationTransaction as testTransaction,
} from './initiate-paystack-cancellation-refunds.test-helpers';
import { recordPaystackCancellationRefund as recordRefund } from './record-paystack-cancellation-refund';

const auditMocks = vi.hoisted(() => ({
  quarantineRefund: vi.fn(),
}));

vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: auditMocks.quarantineRefund,
}));

export function acceptedRefund(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 101,
      status: 'queued',
      transaction: { id: 55, reference: 'PSK-1' },
      ...overrides,
    },
    success: true as const,
  };
}

export function resetRefundAuditMocks() {
  vi.clearAllMocks();
  auditMocks.quarantineRefund.mockImplementation(() => {
    throw new Error('quarantined');
  });
}

export function database({
  conflictRow = null,
  insertError = null,
}: {
  conflictRow?: unknown;
  insertError?: unknown;
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const from = vi.fn().mockImplementation((table: string) => {
    if (table !== 'transactions') throw new Error(`unexpected ${table}`);
    return {
      insert,
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: conflictRow, error: null }),
      })),
    };
  });
  return {
    from,
    insert,
    supabase: { from } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>,
  };
}

export const initiationOrder = testOrder;
export const initiationTransaction = testTransaction;
export const recordPaystackCancellationRefund = recordRefund;
export const mocks = auditMocks;
