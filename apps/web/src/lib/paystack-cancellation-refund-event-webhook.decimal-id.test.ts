import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePaystackCancellationRefundEvent } from './paystack-cancellation-refund-event-webhook';

const mocks = vi.hoisted(() => ({
  reconcilePaystackCancellationRefund: vi.fn(),
  reconcilePaystackRefundEvent: vi.fn(),
  recoverUnknownPaystackRefund: vi.fn(),
}));

vi.mock('@/lib/payments/reconcile-paystack-cancellation-refund', () => ({
  reconcilePaystackCancellationRefund:
    mocks.reconcilePaystackCancellationRefund,
}));
vi.mock('@/lib/payments/reconcile-paystack-refund-event', () => ({
  reconcilePaystackRefundEvent: mocks.reconcilePaystackRefundEvent,
}));
vi.mock('@/lib/payments/recover-unknown-paystack-refund', () => ({
  recoverUnknownPaystackRefund: mocks.recoverUnknownPaystackRefund,
}));

describe('handlePaystackCancellationRefundEvent decimal-text ids', () => {
  function database(refund: unknown) {
    const query = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue({ data: refund == null ? [] : [refund] }),
      order: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
    };
    return { from: vi.fn(() => query) } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcilePaystackCancellationRefund.mockResolvedValue('updated');
  });

  it('takes the ID path for decimal-text provider ids', async () => {
    const huge = '9007199254740993';
    const refund = {
      cancel_order: {
        cancelled_at: '2026-09-27T00:00:00Z',
        shipping_status: 'cancelled',
      },
      id: 'refund-1',
      gateway: 'paystack',
    };
    const db = database(refund);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: huge, status: 'processed' },
      event: 'refund.processed',
    });

    // The exact text survives to reconciliation: a Number() detour
    // would collapse the id to 9007199254740992 and miss the row.
    expect(mocks.reconcilePaystackCancellationRefund).toHaveBeenCalledWith(
      db,
      refund
    );
    expect(mocks.reconcilePaystackRefundEvent).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('recovers unknown decimal-text provider ids with the exact text', async () => {
    const huge = '9007199254740993';
    const db = database(null);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: huge, status: 'processed' },
      event: 'refund.processed',
    });

    expect(mocks.recoverUnknownPaystackRefund).toHaveBeenCalledWith(
      db,
      huge,
      undefined
    );
    expect(response.status).toBe(200);
  });

  it('falls through to the reference path for malformed ids', async () => {
    const db = database(null);
    mocks.reconcilePaystackRefundEvent.mockResolvedValue(undefined);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: '12x', status: 'processed', transaction_reference: 'ref-9' },
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
    expect(mocks.recoverUnknownPaystackRefund).not.toHaveBeenCalled();
    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      db,
      'ref-9',
      'processed'
    );
    expect(response.status).toBe(200);
  });
});
