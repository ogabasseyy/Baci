import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePaystackCancellationRefundEvent } from './paystack-cancellation-refund-event-webhook';

const mocks = vi.hoisted(() => ({
  fileRefundEvidenceReview: vi.fn(),
  holdPaystackRefundForReview: vi.fn(),
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
vi.mock('@/lib/payments/file-refund-evidence-review', () => ({
  fileRefundEvidenceReview: mocks.fileRefundEvidenceReview,
}));
vi.mock('@/lib/payments/hold-paystack-refund-for-review', () => ({
  holdPaystackRefundForReview: mocks.holdPaystackRefundForReview,
}));
vi.mock('@/lib/payments/recover-unknown-paystack-refund', () => ({
  recoverUnknownPaystackRefund: mocks.recoverUnknownPaystackRefund,
}));

describe('handlePaystackCancellationRefundEvent', () => {
  const supabase = {} as SupabaseClient;

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
  });

  it('reconciles the refund row matching the provider refund ID', async () => {
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

  it('reconciles a held legacy row despite padded gateway casing', async () => {
    const refund = {
      cancel_order: {
        cancelled_at: '2026-09-27T00:00:00Z',
        shipping_status: 'cancelled',
      },
      gateway: ' Paystack ',
      id: 'refund-1',
    };
    const db = database(refund);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 42, status: 'processed', transaction: 123 },
      event: 'refund.processed',
    });

    // An exact gateway match would miss this row and enter
    // unknown-refund recovery, colliding with its own audit row.
    expect(mocks.reconcilePaystackCancellationRefund).toHaveBeenCalledWith(
      db,
      refund
    );
    expect(mocks.recoverUnknownPaystackRefund).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('fails retryably when duplicate audit rows share the provider id', async () => {
    const query = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            { gateway: 'paystack', id: 'refund-1' },
            { gateway: ' Paystack ', id: 'refund-2' },
          ],
        })
        .mockResolvedValue({ data: [] }),
      order: vi.fn().mockReturnThis(),
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

  it('fails retryably when the refund lookup errors', async () => {
    const query = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'db unavailable' },
      }),
      order: vi.fn().mockReturnThis(),
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
    const db = database({
      cancel_order: {
        cancelled_at: '2026-09-27T00:00:00Z',
        shipping_status: 'cancelled',
      },
      id: 'refund-1',
      gateway: 'paystack',
    });
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

  it.each([
    ['missing order', { id: 'refund-1' }],
    [
      'uncancelled order',
      {
        cancel_order: { cancelled_at: null, shipping_status: 'cancelled' },
        id: 'refund-1',
        gateway: 'paystack',
      },
    ],
    [
      'unshipped cancellation',
      {
        cancel_order: {
          cancelled_at: '2026-09-27T00:00:00Z',
          shipping_status: 'pending',
        },
        id: 'refund-1',
        gateway: 'paystack',
      },
    ],
  ])('recovers a non-cancellation refund row (%s) through provider verification', async (_label, refund) => {
    const db = database(refund);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 42, transaction_reference: 'PSK-1' },
      event: 'refund.processed',
    });

    // Pollers only select cancelled orders: acknowledging here without
    // durable evidence would strand a refunded-but-paid order once
    // Paystack stops redelivering, so the event verifies and files
    // the active-order review instead.
    expect(mocks.reconcilePaystackCancellationRefund).not.toHaveBeenCalled();
    expect(mocks.reconcilePaystackRefundEvent).not.toHaveBeenCalled();
    expect(mocks.recoverUnknownPaystackRefund).toHaveBeenCalledWith(
      db,
      42,
      'PSK-1'
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Refund event reconciled',
    });
  });

  it('fails retryably when active-order recovery throws', async () => {
    const db = database({
      cancel_order: { cancelled_at: null, shipping_status: 'cancelled' },
      id: 'refund-1',
      gateway: 'paystack',
    });
    mocks.recoverUnknownPaystackRefund.mockRejectedValue(
      new Error('provider down')
    );

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 42 },
      event: 'refund.processed',
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
      'PSK-1',
      'processed'
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
      'PAYMENT-1',
      'processed'
    );
    expect(response.status).toBe(200);
  });

  it('falls back to the flat reference when the nested value is unusable', async () => {
    const db = database(null);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: {
        transaction: { reference: 'has space' },
        transaction_reference: 'PAYMENT-1',
      },
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      db,
      'PAYMENT-1',
      'processed'
    );
    expect(response.status).toBe(200);
  });

  it('passes the failed verdict to the reference-only path', async () => {
    const db = database(null);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { status: 'failed', transaction_reference: 'PAYMENT-1' },
      event: 'refund.failed',
    });

    // A definitively failed provider refund moved no money: the
    // reference-only reviews filed downstream must carry the verdict
    // so they never block a later genuine cancellation.
    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      db,
      'PAYMENT-1',
      'failed'
    );
    expect(response.status).toBe(200);
  });

  it('derives the failed verdict from the event when data.status is absent', async () => {
    const db = database(null);

    await handlePaystackCancellationRefundEvent(db, {
      data: { transaction_reference: 'PAYMENT-1' },
      event: 'refund.failed',
    });

    // A bare refund.failed still means no money moved: coercing it
    // to 'unknown' would strand the reference, since failed-only
    // evidence exclusion can't match 'unknown'.
    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      db,
      'PAYMENT-1',
      'failed'
    );
  });

  it('derives the processed verdict from the event when data.status is absent', async () => {
    const db = database(null);

    await handlePaystackCancellationRefundEvent(db, {
      data: { transaction_reference: 'PAYMENT-1' },
      event: 'refund.processed',
    });

    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      db,
      'PAYMENT-1',
      'processed'
    );
  });

  it('coerces to unknown when neither status nor event carries a verdict', async () => {
    const db = database(null);

    await handlePaystackCancellationRefundEvent(db, {
      data: { status: 42, transaction_reference: 'PAYMENT-1' },
    });

    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      db,
      'PAYMENT-1',
      'unknown'
    );
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

  it('quarantines deterministic refund-ID mismatches instead of retrying', async () => {
    const refund = {
      cancel_order: {
        cancelled_at: '2026-09-27T00:00:00Z',
        shipping_status: 'cancelled',
      },
      id: 'refund-1',
      gateway: 'paystack',
    };
    const db = database(refund);
    mocks.reconcilePaystackCancellationRefund.mockRejectedValue(
      new Error('refund_payment_link_mismatch')
    );

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 42 },
      event: 'refund.processed',
    });

    expect(mocks.fileRefundEvidenceReview).toHaveBeenCalledWith(
      db,
      refund,
      'refund_payment_link_mismatch'
    );
    expect(mocks.holdPaystackRefundForReview).toHaveBeenCalledWith(
      db,
      'refund-1',
      'refund_payment_link_mismatch'
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Refund event reconciled',
    });
  });

  it('fails retryably when review persistence throws', async () => {
    const db = database({
      cancel_order: {
        cancelled_at: '2026-09-27T00:00:00Z',
        shipping_status: 'cancelled',
      },
      id: 'refund-1',
      gateway: 'paystack',
    });
    mocks.reconcilePaystackCancellationRefund.mockRejectedValue(
      new Error('paystack_refund_evidence_mismatch')
    );
    mocks.fileRefundEvidenceReview.mockRejectedValue(new Error('down'));

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: 42 },
      event: 'refund.processed',
    });

    expect(response.status).toBe(503);
  });

  it.each([
    0, -1,
  ])('falls back to the reference path for a nonpositive refund id (%s)', async (refundId) => {
    const db = database(null);

    const response = await handlePaystackCancellationRefundEvent(db, {
      data: { id: refundId, transaction_reference: 'PAYMENT-1' },
      event: 'refund.processed',
    });

    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.reconcilePaystackRefundEvent).toHaveBeenCalledWith(
      db,
      'PAYMENT-1',
      'processed'
    );
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
