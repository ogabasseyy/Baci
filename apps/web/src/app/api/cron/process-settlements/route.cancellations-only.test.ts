import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  drainFailedOrderCancellationSideEffects: vi.fn(),
  drainPaystackRefundNotifications: vi.fn(),
  reconcileCompletedPaystackCancellationRefunds: vi.fn(),
  reconcilePendingPaystackCancellationRefunds: vi.fn(),
  from: vi.fn(),
  loggerError: vi.fn(),
  rpc: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: mocks.sendEmail,
}));
vi.mock('@/lib/orders/drain-failed-order-cancellation-side-effects', () => ({
  drainFailedOrderCancellationSideEffects:
    mocks.drainFailedOrderCancellationSideEffects,
}));
vi.mock('@/lib/payments/drain-paystack-refund-notifications', () => ({
  drainPaystackRefundNotifications: mocks.drainPaystackRefundNotifications,
}));
vi.mock('@/lib/payments/reconcile-paystack-cancellation-refunds', () => ({
  reconcilePendingPaystackCancellationRefunds:
    mocks.reconcilePendingPaystackCancellationRefunds,
}));
vi.mock(
  '@/lib/payments/reconcile-completed-paystack-cancellation-refunds',
  () => ({
    reconcileCompletedPaystackCancellationRefunds:
      mocks.reconcileCompletedPaystackCancellationRefunds,
  })
);

import { POST } from './route';

function makeCancellationDrainRequest() {
  return new Request(
    'https://usebaci.com/api/cron/process-settlements?cancellationsOnly=true',
    {
      headers: { Authorization: 'Bearer test-secret' },
      method: 'POST',
    }
  );
}

describe('POST /api/cron/process-settlements?cancellationsOnly=true', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    vi.stubEnv('CRON_SECRET', 'test-secret');

    mocks.drainFailedOrderCancellationSideEffects.mockResolvedValue({
      drained: [],
      failed: [],
      skipped: [],
    });
    mocks.reconcilePendingPaystackCancellationRefunds.mockResolvedValue({
      checked: 0,
      failed: 0,
    });
    mocks.reconcileCompletedPaystackCancellationRefunds.mockResolvedValue({
      checked: 0,
      failed: 0,
    });
    mocks.drainPaystackRefundNotifications.mockResolvedValue({
      claimed: 0,
      sent: 0,
      failed: 0,
    });
  });

  it('drains cancellation side effects without running the daily settlement job', async () => {
    const response = await POST(makeCancellationDrainRequest());

    expect(response.status).toBe(200);
    expect(mocks.drainFailedOrderCancellationSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ sendCancellationEmail: mocks.sendEmail })
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(
      mocks.reconcilePendingPaystackCancellationRefunds
    ).toHaveBeenCalled();
    expect(
      mocks.reconcileCompletedPaystackCancellationRefunds
    ).toHaveBeenCalled();
    expect(mocks.drainPaystackRefundNotifications).toHaveBeenCalledWith(
      expect.anything(),
      mocks.sendEmail
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('still reconciles refunds when cancellation side effect draining fails', async () => {
    mocks.drainFailedOrderCancellationSideEffects.mockRejectedValueOnce(
      new Error('temporary failure')
    );
    const response = await POST(makeCancellationDrainRequest());
    expect(response.status).toBe(503);
    expect(
      mocks.reconcilePendingPaystackCancellationRefunds
    ).toHaveBeenCalled();
    expect(mocks.drainPaystackRefundNotifications).toHaveBeenCalled();
  });

  it.each([
    ['pending refunds', 'reconcilePendingPaystackCancellationRefunds'],
    ['legacy refunds', 'reconcileCompletedPaystackCancellationRefunds'],
    ['refund notifications', 'drainPaystackRefundNotifications'],
  ] as const)('returns 503 when fulfilled %s report failures', async (_label, worker) => {
    mocks[worker].mockResolvedValueOnce({
      checked: 1,
      claimed: 1,
      failed: 1,
      sent: 0,
    });
    const response = await POST(makeCancellationDrainRequest());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: 'Cancellation and refund background work incomplete',
    });
  });

  it('returns 503 when the cancellation drain reports failed rows', async () => {
    mocks.drainFailedOrderCancellationSideEffects.mockResolvedValueOnce({
      drained: [],
      failed: [{ orderId: 'order-1', reason: 'failed', step: 'refund' }],
      skipped: [],
    });
    const response = await POST(makeCancellationDrainRequest());

    expect(response.status).toBe(503);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ cancellationFailed: true })
    );
  });
});
