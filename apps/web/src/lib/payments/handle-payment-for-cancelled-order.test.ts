import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  handlePaymentForCancelledOrder,
  isOrderClampedAsCancelled,
} from './handle-payment-for-cancelled-order';

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockCreateAdminClient = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

const { logger } = await import('@/lib/logger');

// The helper files the reconciliation row with a service-role client because the
// table is RLS-locked to service_role; assert it uses createAdminClient, not a
// caller-supplied client.
function mockAdminInsert(insertResult: { error: unknown }): {
  from: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn(() => ({ insert }));
  mockCreateAdminClient.mockReturnValue({ from });
  return { from, insert };
}

describe('isOrderClampedAsCancelled', () => {
  it('returns true when shipping_status is cancelled', () => {
    expect(
      isOrderClampedAsCancelled({ id: 'o1', shipping_status: 'cancelled' })
    ).toBe(true);
  });

  it('returns true for the US-spelled shipping cancellation without cancelled_at', () => {
    expect(
      isOrderClampedAsCancelled({
        id: 'o1',
        cancelled_at: null,
        shipping_status: 'canceled',
      })
    ).toBe(true);
  });

  it('returns true when cancelled_at is set even if shipping_status differs', () => {
    expect(
      isOrderClampedAsCancelled({
        id: 'o1',
        cancelled_at: '2026-06-15T00:00:00Z',
        shipping_status: 'processing',
      })
    ).toBe(true);
  });

  it('returns false for an active processing order', () => {
    expect(
      isOrderClampedAsCancelled({
        id: 'o1',
        cancelled_at: null,
        shipping_status: 'processing',
      })
    ).toBe(false);
  });

  it('returns false for null/undefined order', () => {
    expect(isOrderClampedAsCancelled(null)).toBe(false);
    expect(isOrderClampedAsCancelled(undefined)).toBe(false);
  });
});

describe('handlePaymentForCancelledOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a payment_received_after_cancellation reconciliation row and warns', async () => {
    const { from, insert } = mockAdminInsert({ error: null });

    await handlePaymentForCancelledOrder({
      gatewayReference: 'BAC-123',
      order: { id: 'order-1', shipping_status: 'cancelled' },
      reason: 'Paystack payment captured after cancellation',
      transactionId: 'txn-1',
    });

    expect(mockCreateAdminClient).toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('reconciliation_review');
    expect(insert).toHaveBeenCalledWith({
      candidates: null,
      issue_type: 'payment_received_after_cancellation',
      order_id: 'order-1',
      paystack_ref: 'BAC-123',
      reason: 'Paystack payment captured after cancellation',
      txn_id: 'txn-1',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayReference: 'BAC-123',
        orderId: 'order-1',
        transactionId: 'txn-1',
      })
    );
  });

  it('treats a duplicate (23505) as a benign no-op and does not log an error', async () => {
    mockAdminInsert({
      error: { code: '23505', message: 'duplicate key value' },
    });

    await handlePaymentForCancelledOrder({
      gatewayReference: 'BAC-123',
      order: { id: 'order-1', shipping_status: 'cancelled' },
      reason: 'retry',
      transactionId: 'txn-1',
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1' })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs an error but does not throw when admin client setup throws', async () => {
    mockCreateAdminClient.mockImplementation(() => {
      throw new Error('missing env');
    });

    await expect(
      handlePaymentForCancelledOrder({
        gatewayReference: 'BAC-123',
        order: { id: 'order-1', shipping_status: 'cancelled' },
        reason: 'setup failure',
        transactionId: 'txn-1',
      })
    ).resolves.toBe(false);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Failed to file payment_received_after_cancellation reconciliation (threw)',
        orderId: 'order-1',
      })
    );
  });

  it('logs an error (but does not throw) when the insert fails for a non-duplicate reason', async () => {
    mockAdminInsert({
      error: { code: '500', message: 'boom' },
    });

    await expect(
      handlePaymentForCancelledOrder({
        gatewayReference: null,
        order: { id: 'order-1', shipping_status: 'cancelled' },
        reason: 'failure path',
        transactionId: null,
      })
    ).resolves.toBe(false);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Failed to file payment_received_after_cancellation reconciliation',
        orderId: 'order-1',
      })
    );
  });
});
