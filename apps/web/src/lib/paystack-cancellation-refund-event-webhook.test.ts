import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePaystackCancellationRefundEvent } from './paystack-cancellation-refund-event-webhook';

const mocks = vi.hoisted(() => ({
  reconcilePaystackRefundEvent: vi.fn(),
}));

vi.mock('@/lib/payments/reconcile-paystack-refund-event', () => ({
  reconcilePaystackRefundEvent: mocks.reconcilePaystackRefundEvent,
}));

describe('handlePaystackCancellationRefundEvent', () => {
  const supabase = {} as SupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcilePaystackRefundEvent.mockResolvedValue(undefined);
  });

  it('reconciles the transaction reference and acknowledges the event', async () => {
    const response = await handlePaystackCancellationRefundEvent(supabase, {
      data: { transaction_reference: 'PAYMENT-1' },
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      supabase,
      'PAYMENT-1'
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Refund event reconciled',
    });
  });

  it('acknowledges events without a transaction reference', async () => {
    const response = await handlePaystackCancellationRefundEvent(supabase, {
      data: {},
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackRefundEvent).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('fails retryably when reconciliation throws', async () => {
    mocks.reconcilePaystackRefundEvent.mockRejectedValue(new Error('down'));

    const response = await handlePaystackCancellationRefundEvent(supabase, {
      data: { transaction_reference: 'PAYMENT-1' },
      event: 'refund.failed',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Refund reconciliation unavailable',
    });
  });
});
