import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeVerifiedWedge } from './finalize-verified-wedge';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const candidate = {
  amount: '58290.60',
  created_at: '2026-07-01T00:00:00.000Z',
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: '100004260711172450165090811595',
  id: 'txn-1',
  merchant_id: 'merchant-1',
  metadata: null,
  order_id: 'order-1',
  platform_fee: null,
  status: 'completed',
} as const;

function summary() {
  return {
    checked: 0,
    detectedUnhealable: [],
    failed: [],
    healed: [],
    reviewsFiled: [],
    skipped: [],
  };
}

describe('finalizeVerifiedWedge outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a heal when the finalizer completes without a duplicate capture', async () => {
    const finalizePayment = vi.fn().mockResolvedValue({
      healed: true,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    const shape = summary();
    const result = await finalizeVerifiedWedge({
      candidate: { ...candidate },
      deadlineMs: undefined,
      finalizePayment,
      scheduleAfter: () => {},
      stampResolution: vi.fn(),
      summary: shape,
      supabase: {} as never,
      verification: { amount: 5829060, ok: true, response: {} },
    });

    expect(result).toBe('finalized');
    expect(shape.healed).toEqual([
      { orderId: 'order-1', orderNumber: 'ORD-1' },
    ]);
    expect(shape.failed).toEqual([]);
  });

  it('stamps terminal cancelled outcomes exactly once', async () => {
    const stampResolution = vi.fn().mockResolvedValue(true);
    const shape = summary();
    const result = await finalizeVerifiedWedge({
      candidate: { ...candidate },
      deadlineMs: undefined,
      finalizePayment: vi.fn().mockResolvedValue({ kind: 'order_cancelled' }),
      scheduleAfter: () => {},
      stampResolution,
      summary: shape,
      supabase: {} as never,
      verification: { amount: 5829060, ok: true, response: {} },
    });

    expect(result).toBe('finalized');
    expect(shape.reviewsFiled).toEqual([
      { orderId: 'order-1', transactionId: 'txn-1' },
    ]);
    expect(stampResolution).toHaveBeenCalledTimes(1);
    expect(stampResolution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'txn-1' }),
      'order_cancelled'
    );
  });

  it('records a failure when the finalizer reports a failed kind', async () => {
    const shape = summary();
    const result = await finalizeVerifiedWedge({
      candidate: { ...candidate },
      deadlineMs: undefined,
      finalizePayment: vi.fn().mockResolvedValue({
        error: new Error('nope'),
        kind: 'order_fetch_failed',
      }),
      scheduleAfter: () => {},
      stampResolution: vi.fn(),
      summary: shape,
      supabase: {} as never,
      verification: { amount: 5829060, ok: true, response: {} },
    });

    expect(result).toBe('finalized');
    expect(shape.failed).toEqual([
      { reason: 'order_fetch_failed', transactionId: 'txn-1' },
    ]);
  });
});
