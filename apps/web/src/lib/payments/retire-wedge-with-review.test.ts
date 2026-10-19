import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retireWedgeWithReview } from '@/lib/payments/retire-wedge-with-review';

const mocks = vi.hoisted(() => ({
  handlePaymentForCancelledOrder: vi.fn(),
}));

vi.mock('@/lib/payments/handle-payment-for-cancelled-order', () => ({
  handlePaymentForCancelledOrder: mocks.handlePaymentForCancelledOrder,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

function buildSupabase(stamped: unknown = true) {
  const rpc = vi.fn().mockResolvedValue({ data: stamped, error: null });
  const from = vi.fn();
  return { from, rpc, supabase: { from, rpc } };
}

describe('retireWedgeWithReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files a transaction-scoped review before stamping the wedge resolved', async () => {
    mocks.handlePaymentForCancelledOrder.mockResolvedValue(true);
    const { from, rpc, supabase } = buildSupabase();

    const result = await retireWedgeWithReview({
      candidate: {
        gateway: 'paystack',
        gateway_reference: 'ref-1',
        id: 'txn-1',
        metadata: null,
        order_id: 'order-1',
      },
      reason: 'manual reconciliation required',
      resolution: 'gateway_reference_invalid',
      supabase: supabase as never,
    });

    expect(result).toBe(true);
    expect(mocks.handlePaymentForCancelledOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        issueType: 'gateway_payment_wedge_requires_review',
        transactionId: 'txn-1',
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.objectContaining({
        p_resolution: 'gateway_reference_invalid',
        p_transaction_id: 'txn-1',
      })
    );
    // The stamp merges database-side: no read-modify-write spreads the
    // stale metadata snapshot over concurrent completions.
    expect(from).not.toHaveBeenCalled();
  });

  it('does not retire a wedge when its review is not durable', async () => {
    mocks.handlePaymentForCancelledOrder.mockResolvedValue(false);
    const { rpc, supabase } = buildSupabase();

    const result = await retireWedgeWithReview({
      candidate: {
        gateway: 'paystack',
        gateway_reference: 'ref-1',
        id: 'txn-1',
        metadata: null,
        order_id: 'order-1',
      },
      reason: 'manual reconciliation required',
      resolution: 'gateway_reference_invalid',
      supabase: supabase as never,
    });

    expect(result).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports failure when the atomic stamp misses', async () => {
    mocks.handlePaymentForCancelledOrder.mockResolvedValue(true);
    const { rpc, supabase } = buildSupabase(false);

    const result = await retireWedgeWithReview({
      candidate: {
        gateway: 'paystack',
        gateway_reference: 'ref-1',
        id: 'txn-1',
        metadata: null,
        order_id: 'order-1',
      },
      reason: 'manual reconciliation required',
      resolution: 'gateway_reference_invalid',
      supabase: supabase as never,
    });

    expect(result).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      'stamp_wedge_sweep_resolution_v1',
      expect.anything()
    );
  });
});
