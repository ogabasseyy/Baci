import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePaystackCancellationRefundEvent } from './paystack-cancellation-refund-event-webhook';

const mocks = vi.hoisted(() => ({
  reconcilePaystackCancellationRefund: vi.fn(),
  reconcilePaystackRefundEvent: vi.fn(),
}));

vi.mock('@/lib/payments/reconcile-paystack-cancellation-refund', () => ({
  reconcilePaystackCancellationRefund:
    mocks.reconcilePaystackCancellationRefund,
}));
vi.mock('@/lib/payments/reconcile-paystack-refund-event', () => ({
  reconcilePaystackRefundEvent: mocks.reconcilePaystackRefundEvent,
}));

describe('handlePaystackCancellationRefundEvent', () => {
  const supabase = {} as SupabaseClient;

  function database(refund: unknown) {
    const query = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: refund ?? null }),
      select: vi.fn().mockReturnThis(),
    };
    return { from: vi.fn(() => query) } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcilePaystackRefundEvent.mockResolvedValue(undefined);
    mocks.reconcilePaystackCancellationRefund.mockResolvedValue('updated');
  });

  it('reconciles the refund row matching the provider refund ID', async () => {
    const refund = { id: 'refund-1' };
    const db = database(refund);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 42, status: 'processed', transaction: 123 },
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackCancellationRefund).toHaveBeenCalledWith(
      db,
      refund
    );
    expect(mocks.reconcilePaystackRefundEvent).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Refund event reconciled',
    });
  });

  it('fails retryably when the refund lookup errors', async () => {
    const query = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'db unavailable' },
      }),
      select: vi.fn().mockReturnThis(),
    };
    const db = { from: vi.fn(() => query) } as unknown as SupabaseClient;

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 42 },
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
  });

  it('fails retryably when the refund-ID reconciliation throws', async () => {
    const db = database({ id: 'refund-1' });
    mocks.reconcilePaystackCancellationRefund.mockRejectedValue(
      new Error('down')
    );

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 42 },
      event: 'refund.failed',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Refund reconciliation unavailable',
    });
  });

  it('falls back to the nested transaction reference', async () => {
    const db = database(null);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { transaction: { reference: 'PSK-1' } },
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      db,
      'PSK-1'
    );
    expect(response.status).toBe(200);
  });

  it('retains the flat transaction reference for compatibility', async () => {
    const db = database(null);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { transaction_reference: 'PAYMENT-1' },
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      db,
      'PAYMENT-1'
    );
    expect(response.status).toBe(200);
  });

  it('acknowledges events without any usable reference', async () => {
    const response = await handlePaystackCancellationRefundEvent(supabase, {
      data: {},
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
    expect(mocks.reconcilePaystackRefundEvent).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('fails retryably when event reconciliation throws', async () => {
    const db = database(null);
    mocks.reconcilePaystackRefundEvent.mockRejectedValue(new Error('down'));

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { transaction_reference: 'PAYMENT-1' },
      event: 'refund.failed',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Refund reconciliation unavailable',
    });
  });
});
