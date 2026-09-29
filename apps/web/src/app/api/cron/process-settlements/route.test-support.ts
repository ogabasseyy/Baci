import type { Mock } from 'vitest';
import { vi } from 'vitest';

export function makeCronRequest(secret = 'test-secret') {
  return new Request('https://usebaci.com/api/cron/process-settlements', {
    headers: {
      Authorization: `Bearer ${secret}`,
    },
    method: 'POST',
  });
}

type RouteMocks = Record<
  | 'drainFailedOrderCancellationSideEffects'
  | 'drainPaystackRefundNotifications'
  | 'eq'
  | 'from'
  | 'in'
  | 'limit'
  | 'order'
  | 'reconcileCompletedPaystackCancellationRefunds'
  | 'reconcilePendingPaystackCancellationRefunds'
  | 'rpc'
  | 'select'
  | 'sendEmail'
  | 'update',
  Mock
>;

/**
 * Stub the default full-path settlement run: an empty settlement batch,
 * one notifiable merchant settlement, delivered email, and idle
 * cancellation/refund workers. Tests override individual mocks after this.
 */
export function stubDefaultSettlementRun(mocks: RouteMocks) {
  vi.stubEnv('CRON_SECRET', 'test-secret');

  mocks.rpc.mockResolvedValue({
    data: [{ details: [], processed_count: 0, total_amount: 0 }],
    error: null,
  });
  mocks.select.mockReturnValue({
    eq: mocks.eq,
    in: mocks.in,
    limit: mocks.limit,
    order: mocks.order,
  });
  mocks.eq.mockReturnValue({
    eq: mocks.eq,
    in: mocks.in,
    limit: mocks.limit,
    order: mocks.order,
  });
  mocks.order.mockReturnValue({
    limit: mocks.limit,
  });
  mocks.limit.mockResolvedValue({
    data: [
      {
        actual_settlement_date: '2026-05-31',
        description: 'Order BAC-123',
        gateway: 'paystack',
        id: 'settlement-1',
        merchant_id: 'merchant-1',
        merchants: {
          business_name: 'Merchant Shop',
          email: 'merchant@example.com',
          id: 'merchant-1',
        },
        net_amount: 2500,
        source_type: 'order',
      },
    ],
    error: null,
  });
  mocks.update.mockReturnValue({
    eq: mocks.eq,
    in: mocks.in,
  });
  // Revalidation reads the snapshotted row as still settled by default;
  // the guarded mark ignores its resolution.
  mocks.in.mockResolvedValue({
    data: [
      {
        id: 'settlement-1',
        settlement_notified: false,
        status: 'settled',
      },
    ],
    error: null,
  });
  mocks.from
    .mockReturnValueOnce({ select: mocks.select })
    .mockReturnValueOnce({ select: mocks.select })
    .mockReturnValueOnce({ update: mocks.update });
  mocks.sendEmail.mockResolvedValue({ messageId: 'msg-1', success: true });
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
}
