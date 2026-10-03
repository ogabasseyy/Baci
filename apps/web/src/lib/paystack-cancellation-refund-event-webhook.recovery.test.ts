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

describe('handlePaystackCancellationRefundEvent unknown-refund recovery', () => {
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
    mocks.reconcilePaystackRefundEvent.mockResolvedValue(undefined);
    mocks.reconcilePaystackCancellationRefund.mockResolvedValue('updated');
    mocks.recoverUnknownPaystackRefund.mockResolvedValue(undefined);
  });

  it('recovers an unknown provider refund instead of rechecking stale rows', async () => {
    const db = database(null);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 202, transaction: { reference: 'PSK-1' } },
      event: 'refund.processed',
    });

    expect(mocks.recoverUnknownPaystackRefund).toHaveBeenCalledWith(
      db,
      202,
      'PSK-1'
    );
    expect(mocks.reconcilePaystackRefundEvent).not.toHaveBeenCalled();
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('recovers an ID-only refund event with a numeric transaction', async () => {
    const db = database(null);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 202, transaction: 555 },
      event: 'refund.processed',
    });

    expect(mocks.recoverUnknownPaystackRefund).toHaveBeenCalledWith(
      db,
      202,
      undefined
    );
    expect(response.status).toBe(200);
  });

  it('fails retryably when unknown-refund recovery throws', async () => {
    const db = database(null);
    mocks.recoverUnknownPaystackRefund.mockRejectedValue(new Error('down'));

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 202, transaction_reference: 'PAYMENT-1' },
      event: 'refund.processed',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Refund reconciliation unavailable',
    });
  });
});
